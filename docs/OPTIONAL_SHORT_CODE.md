# Hướng dẫn thêm short code tùy chọn và ô URL vừa nội dung

Tài liệu ghi lại thiết kế và cách triển khai đã được áp dụng. Source hiện dùng route redirect `/{short_code}`; API tạo/list/xóa vẫn ở `/api/urls`.

## 1. Quy ước trước khi sửa

| Input short_code | Kết quả |
|---|---|
| Bỏ field, null, rỗng hoặc chỉ khoảng trắng | Backend sinh code như hiện tại |
| Chuỗi chữ/số ASCII, 1–32 ký tự | Dùng chính code đó, có phân biệt hoa/thường |
| Khoảng trắng ở đầu/cuối | Trim trước khi xử lý |
| Có dấu cách giữa chuỗi, slash, ký tự đặc biệt hoặc dài quá 32 | HTTP 422 |
| api, app, docs, redoc, không phân biệt hoa/thường | HTTP 422 vì dành cho routing |
| Code đã có, kể cả bản ghi đã hết hạn | HTTP 409; không tự đổi sang code ngẫu nhiên |
| Code đã được xóa | Có thể dùng lại; giữ kiểm tra cache cũ trong service hiện tại |

Ví dụ: `myLink2026` hợp lệ; `my-link` không hợp lệ theo quy ước chữ/số của hướng dẫn này. Không có migration: model đã có cột short_code VARCHAR(32) và unique index.

Về width: hướng dẫn áp dụng fit theo link **sau khi Shorten**; chế độ nhập/Expand giữ full width như hiện tại. Nếu link ngắn đủ chỗ, input rộng bằng chữ + padding; cả control phải cộng thêm nút và border. Link vượt khung vẫn giới hạn 100% để không làm vỡ layout.

## 2. Backend

### 2.1. Schema: backend/app/schemas/url.py

Thêm import `re`. Khai báo constant ngoài class:

```python
import re

RESERVED_SHORT_CODES = {"api", "app", "docs", "redoc"}
```

Trong UrlCreate, thêm field và validator sau; giữ nguyên validator original_url và expires_at hiện có:

```python
class UrlCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    original_url: HttpUrl
    expires_at: datetime | None = None
    short_code: str | None = None

    @field_validator("short_code", mode="before")
    @classmethod
    def validate_short_code(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Short code must be a string")

        code = value.strip()
        if not code:
            return None
        if not re.fullmatch(r"[A-Za-z0-9]{1,32}", code):
            raise ValueError("Use 1-32 ASCII letters or digits")
        if code.lower() in RESERVED_SHORT_CODES:
            raise ValueError("This short code is reserved")
        return code

    # Giữ hai validator original_url và expires_at hiện có ở đây.
```

Không đặt max_length trước bước trim nếu muốn chấp nhận chuỗi có khoảng trắng bao quanh nhưng code sau trim vẫn hợp lệ.

### 2.2. Service: backend/app/services/url_service.py

Import thêm RESERVED_SHORT_CODES từ schemas.url cùng UrlCreate. Giữ nguyên CodeGenerationError, _short_code_collision và _as_utc; thêm exception:

```python
class ShortCodeTaken(Exception):
    pass
```

Thay create_short_url bằng:

```python
def create_short_url(db: Session, payload: UrlCreate) -> Url:
    expiration = payload.expires_at or (
        datetime.now(timezone.utc) + timedelta(days=30)
    )
    custom = payload.short_code is not None
    attempts = 1 if custom else MAX_ATTEMPTS

    for attempt in range(attempts):
        code = (
            payload.short_code
            if custom
            else generate_short_code(settings.short_code_length)
        )

        # Cả mã tự sinh cũng không được đụng tên route dành riêng.
        if code.lower() in RESERVED_SHORT_CODES:
            continue

        url = Url(
            short_code=code,
            original_url=str(payload.original_url),
            created_at=datetime.now(timezone.utc),
            expires_at=_as_utc(expiration),
        )
        db.add(url)
        try:
            db.commit()
        except IntegrityError as error:
            db.rollback()
            if not _short_code_collision(error):
                raise
            if custom:
                raise ShortCodeTaken() from error
            logger.warning(
                "Short code collision (attempt %d/%d)",
                attempt + 1, MAX_ATTEMPTS,
            )
            continue

        db.refresh(url)
        logger.info("[DATABASE] Created %s", url.short_code)
        return url

    raise CodeGenerationError("Could not allocate a short code")
```

Không chỉ SELECT kiểm tra code rồi tin rằng INSERT sẽ thành công: hai request có thể cùng thấy code còn trống. Unique index và nhánh bắt IntegrityError mới quyết định việc tạo thành công. Với custom code chỉ thử một lần; random code vẫn retry có giới hạn.

Không cần sửa resolve_short_code/delete_url: hiện đã xử lý cache stale và invalidation. Không tái sử dụng tự động code của link hết hạn vì bản ghi vẫn còn trong DB.

### 2.3. Endpoint POST: backend/app/api/urls.py

Trong create_url, giữ header no-store và bọc lời gọi service:

```python
def create_url(
    payload: UrlCreate,
    response: Response,
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return url_service.create_short_url(db, payload)
    except url_service.ShortCodeTaken:
        raise HTTPException(
            status_code=409,
            detail="Short code already exists",
            headers={"Cache-Control": "no-store"},
        ) from None
```

Trong decorator POST, đổi mô tả responses[409] thành `Short code already exists or database constraint conflict`. 422 validation vẫn do FastAPI cung cấp; GET/DELETE và redirect không đổi.

## 3. Frontend

### 3.1. API helper: frontend/lib/api.js

Thêm tham số thứ ba, có default để các caller cũ vẫn chạy:

```javascript
export async function shortenUrl(
    originalUrl,
    expirationValue,
    shortCode = '',
) {
    const expiredAt = normalizeExpiration(expirationValue);
    const headers = { 'Content-Type': 'application/json' };
    const payload = {
        original_url: originalUrl,
        expires_at: expiredAt,
    };

    const customCode = shortCode.trim();
    if (customCode) payload.short_code = customCode;

    // Giữ phần try/catch và response handling hiện có.
    // Trong fetch, thay body bằng:
    // body: JSON.stringify(payload),
}
```

Đây là đoạn minh họa phần thay đổi, **không thay toàn bộ hàm bằng snippet này**. Giữ logic fetch, timeout, lỗi HTTP, parse JSON và return getShortUrl(data?.short_code).

Với HTTP 409, đổi thông báo thành `Short code unavailable or URL conflict. Choose another code and try again.` để người dùng biết cần chỉnh input. Không đọc raw error/traceback từ backend lên giao diện.

### 3.2. Form: frontend/components/UrlForm.jsx

Thêm state:

```javascript
const [shortCode, setShortCode] = useState('');
```

Thêm field dưới ô URL, trước expiration:

```jsx
<label htmlFor="short-code">Custom short code (optional)</label>
<input
    id="short-code"
    name="short_code"
    className="short-code-input"
    type="text"
    value={shortCode}
    onChange={(event) => {
        setShortCode(event.target.value.trim());
        announce('');
    }}
    pattern="[A-Za-z0-9]{1,32}"
    maxLength={32}
    title="Use 1-32 letters or digits; leave empty for an automatic code"
    placeholder="e.g. myLink2026"
    autoCapitalize="none"
    spellCheck={false}
    aria-describedby="short-code-hint url-status"
    disabled={busy || Boolean(pair.current)}
/>
<p id="short-code-hint" className="url-hint">
    Leave empty to generate a code automatically.
</p>
```

Không thêm required vì field optional. Form hiện đã gọi reportValidity(), nên pattern được kiểm tra trước khi POST. Backend vẫn là nơi xác thực cuối cùng, bao gồm tên reserved.

Trong switchUrl:

```javascript
const short = await shortenUrl(original, expiredAt, shortCode);
```

Trong resetForm, thêm `setShortCode('')`. Khi có pair.current, input custom code bị khóa như expiration. Sau lỗi 409, pair chưa được tạo nên người dùng vẫn sửa code để thử lại. Giữ nhánh Shorten/Expand tái sử dụng pair để không POST thêm cho tới Reset.

CSS thêm vào style.css, không sửa rule input URL để áp dụng cho field custom:

```css
.short-code-input {
    width: 100%;
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
}
```

## 4. Width ô URL = width chữ + padding

Không dùng value.length * một số pixel hoặc đơn vị ch để đo URL với font hiện tại: chữ i và W có độ rộng khác nhau. Đo một span ẩn có cùng font/letter-spacing với input.

Công thức khi không bị giới hạn bởi parent:

- input width = text width + input padding + input border.
- control width = input width + button width + control padding/border + gap.
- width thực tế = min(width mong muốn, width khung form).

### 4.1. State/ref và đo kích thước

Trong UrlForm.jsx thêm useLayoutEffect vào import từ React, rồi thêm:

```javascript
const measureRef = useRef(null);
const [compactWidth, setCompactWidth] = useState(null);

useLayoutEffect(() => {
    const space = fieldSpaceRef.current;
    const control = controlRef.current;
    const input = control.querySelector('#url');
    const button = control.querySelector('.url-toggle');
    const measure = measureRef.current;

    const px = (style, property) =>
        Number.parseFloat(style[property]) || 0;

    function updateWidth() {
        const inputStyle = getComputedStyle(input);
        const controlStyle = getComputedStyle(control);

        measure.style.font = inputStyle.font;
        measure.style.letterSpacing = inputStyle.letterSpacing;

        const inputExtra =
            px(inputStyle, 'paddingLeft') +
            px(inputStyle, 'paddingRight') +
            px(inputStyle, 'borderLeftWidth') +
            px(inputStyle, 'borderRightWidth');

        const controlExtra =
            px(controlStyle, 'paddingLeft') +
            px(controlStyle, 'paddingRight') +
            px(controlStyle, 'borderLeftWidth') +
            px(controlStyle, 'borderRightWidth') +
            px(controlStyle, 'columnGap');

        const wanted =
            measure.getBoundingClientRect().width +
            inputExtra +
            button.getBoundingClientRect().width +
            controlExtra +
            2; // Dự phòng làm tròn subpixel/caret.

        setCompactWidth(Math.min(
            space.clientWidth,
            Math.ceil(wanted),
        ));
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(space);
    return () => observer.disconnect();
}, [value, busy]);
```

Các ref/state/hook phải ở đầu component, trước return và không nằm trong nhánh if. Dự án hiện dùng system font; nếu sau này thêm web font tải bất đồng bộ, cần đo lại sau document.fonts.ready.

### 4.2. Thêm span đo và cập nhật style của control

Đặt span làm con của .url-field-space, **ngoài .url-control** để không ảnh hưởng flex layout:

```jsx
<span ref={measureRef} className="url-measure" aria-hidden="true">
    {value || 'https://example.com/your-long-link'}
</span>
```

Thay prop style của .url-control hiện tại bằng object kết hợp cả hai biến:

```jsx
style={{
    '--compact-width': compactWidth == null
        ? undefined
        : `${compactWidth}px`,
    '--drag-width': dragging ? `${dragWidth}px` : undefined,
}}
```

Không bỏ --drag-width, nếu không gesture kéo sẽ mất hiệu lực. handlePointerDown hiện đọc --compact-width qua getComputedStyle nên nhận được pixel mới từ inline style; không cần thay logic pointer.

### 4.3. CSS

Thêm rule cho span đo:

```css
.url-measure {
    position: fixed;
    right: 100%;
    top: 0;
    visibility: hidden;
    pointer-events: none;
    white-space: pre;
    width: max-content;
    font: inherit;
}
```

Giữ các rule hiện tại:

```css
.url-control {
    max-width: 100%;
    /* Giữ các thuộc tính khác hiện có. */
}

.url-control[data-mode="short"] {
    width: var(--drag-width, var(--compact-width));
}
```

Gỡ rule `.hero .url-control { --compact-width: 92%; }` để không còn cấu hình phần trăm gây hiểu nhầm; inline pixel sẽ là giá trị thực sau khi đo. Giữ fallback --compact-width trong rule base/mobile cho trước lần đo đầu tiên. Chế độ long vẫn full width theo rule base.

Input URL vẫn dùng flex: 1 1 0 và width: 0 như hiện tại: control đã đo vừa đủ nên phần còn lại sau nút chính là text + padding. Khi parent quá hẹp, link được giới hạn bởi khung, input có thể cần cuộn ngang để xem hết.

## 5. Test backend

Thêm vào test_urls.py; sử dụng fixtures client/db hiện có và các import datetime, timedelta, timezone, pytest đã có:

```python
def test_create_custom_short_code(client):
    result = client.post("/api/urls", json=payload(
        short_code="myLink2026",
    ))
    assert result.status_code == 201
    assert result.json()["short_code"] == "myLink2026"
    redirect = client.get("/myLink2026", follow_redirects=False)
    assert redirect.status_code == 302
    assert redirect.headers["location"] == "https://example.com/long"


@pytest.mark.parametrize("custom", [None, "", "   "])
def test_empty_custom_code_generates_random_code(client, custom):
    result = client.post("/api/urls", json=payload(short_code=custom))
    assert result.status_code == 201
    assert len(result.json()["short_code"]) == 7


@pytest.mark.parametrize("custom", [
    "a/b", "a b", "my-link", "a" * 33,
    "docs", "DoCs", "redoc", "api", "app", 123,
])
def test_rejects_invalid_custom_code(client, custom):
    result = client.post("/api/urls", json=payload(short_code=custom))
    assert result.status_code == 422


def test_duplicate_custom_code_returns_409(client, db):
    first = client.post("/api/urls", json=payload(short_code="myCode"))
    assert first.status_code == 201
    second = client.post("/api/urls", json=payload(short_code="myCode"))
    assert second.status_code == 409
    assert second.json()["detail"] == "Short code already exists"
    assert len(list(db.scalars(select(Url)))) == 1
```

Bổ sung thêm các assertion/test sau ở module phù hợp:

| Tình huống | Mong đợi |
|---|---|
| short_code="  myCode  " | Tạo myCode sau trim |
| myCode và MyCode | Tạo được hai mã khác nhau |
| Mã custom có 32 ký tự | Được chấp nhận |
| Mã custom trùng bản ghi đã hết hạn | 409, không sửa/xóa bản ghi cũ |
| Tạo custom code hợp lệ | generate_short_code không được gọi |
| Custom trùng | Không retry và rollback; không thay destination cũ |
| Random trùng | Các test retry thành công/hết số lần thử hiện có vẫn pass |
| Random sinh ra tên reserved | Bỏ mã đó, thử mã khác trong giới hạn MAX_ATTEMPTS |
| IntegrityError không liên quan short_code | Vẫn raise/rollback như test cũ |
| Xóa custom code rồi tạo lại với destination khác | Redirect dùng destination mới, không lấy cache stale |

Giữ toàn bộ test cũ; không đổi kỳ vọng random mặc định để làm custom test pass. Unique race thật trên PostgreSQL là test tích hợp riêng, không được suy ra từ mock SQLite.

## 6. Test frontend và E2E

### 6.1. API helper

Trong api.test.mjs giữ test auto hiện tại: khi bỏ tham số thứ ba, body vẫn chỉ có original_url và expires_at. Thêm test custom:

- Gọi shortenUrl(original, expiration, '  myCode  ').
- Mock fetch assert URL vẫn /api/urls, body có short_code='myCode'.
- Mock response có short_code='myCode'; helper trả https://short.example/myCode.
- Với chuỗi rỗng/khoảng trắng, body không chứa short_code.
- Mock 409: helper reject thông báo phù hợp; giữ các test timeout/lỗi hiện có.

### 6.2. Đồng bộ mockApi của Playwright

Trong POST branch của mockApi, sau khi đọc body và ghi requests.creates, dùng code người nhập hoặc fallback code tự sinh. Thay phần tạo bản ghi bằng:

```javascript
const code = body.short_code || `code${requests.creates.length}`;
if (urls.some((item) => item.short_code === code)) {
    await route.fulfill({
        status: 409,
        json: { detail: 'Short code already exists' },
    });
    return;
}

const created = makeUrl(code, {
    short_url: `${new URL(request.url()).origin}/${code}`,
    original_url: body.original_url,
    expires_at: body.expires_at,
});
urls.unshift(created);
await route.fulfill({ status: 201, json: created });
return;
```

Đây chỉ là mock tối thiểu cho test custom/collision; validation đầy đủ nằm ở backend tests.

Thêm test trong cùng file để dùng mockApi/openForm hiện có:

```javascript
test('creates a custom code and resets it', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);
    const custom = page.getByLabel('Custom short code (optional)');
    await custom.fill('myCode');
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect(page.getByLabel('Paste your URL'))
        .toHaveValue(`${BASE_URL}/myCode`);
    expect(requests.creates[0].short_code).toBe('myCode');
    await expect(custom).toBeDisabled();

    await page.getByRole('button', { name: 'Expand it!' }).click();
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    expect(requests.creates).toHaveLength(1);

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(custom).toHaveValue('');
    await expect(custom).toBeEnabled();
});
```

Thêm các trường hợp:

| Tình huống | Assertion |
|---|---|
| Để trống custom field | Vẫn tạo link tự động, không required error |
| Ký tự sai pattern | Browser validity lỗi và không POST |
| Mock 409 | Có thông báo, giữ URL/expiration/custom để sửa, input không bị khóa |
| Sửa custom sau 409 | Tạo lại thành công bằng mã mới |
| Short code ngắn/dài | Link hiển thị đúng, Go/Copy vẫn dùng short_url |
| Width short | Control gần bằng span đo + input padding/border + nút + control padding/border/gap; cho phép sai số 2–3px |
| Parent hẹp hoặc viewport mobile | Control không vượt .url-field-space; document không tràn ngang |
| Thay viewport | ResizeObserver tính lại width |
| Shorten/Expand và thao tác kéo | --drag-width vẫn ưu tiên khi kéo; khi thả trở về width của chế độ tương ứng |

Test width nên dùng expect.poll hoặc expect.toPass để đợi transition hiện tại kết thúc, hoặc chạy với reducedMotion='reduce' như config mặc định. Không assert số pixel cố định vì font và viewport có thể khác. Chỉ assert input vừa đủ text khi tổng width mong muốn không vượt parent; trường hợp bị clamp phải kiểm tra không tràn.

### 6.3. Live E2E

Trong live test, nhập một code riêng cho lần chạy:

```javascript
const customCode = `e2e${Date.now()}`;
await page.getByLabel('Custom short code (optional)').fill(customCode);
```

Sau POST assert response.short_code === customCode; tiếp tục assert input, GET /{code} trả 302, DELETE /api/urls/{code} trả 204 và GET sau xóa 404 như test hiện tại. Giữ cleanup finally. Nếu tạo thêm test collision thật, tự tạo code riêng cho test, POST lần hai phải 409 rồi cleanup bản ghi đầu.

## 7. Chạy kiểm tra và cập nhật tài liệu tổng hợp

Từ backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Từ frontend:

```powershell
node --test tests/api.test.mjs
node -e "const r=require('node:child_process').spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,NEXT_PUBLIC_API_BASE_URL:''}});process.exit(r.status??1)"
npm.cmd run test:e2e
```

Live E2E cần frontend dev port 3000, backend port 8000 với database test riêng:

```powershell
npm.cmd run test:e2e -- --config=playwright.live.config.mjs
```

Xem [README kiểm thử](README.md) để cài dependencies và chuẩn bị môi trường. Khi triển khai xong, thêm các case mới và kết quả thật vào tài liệu tổng hợp; số 48 hiện tại sẽ tăng sau khi thêm test.

Hướng dẫn này không tạo migration, không đổi API quản lý, không thêm package và không yêu cầu thay CI: các test mới cùng thư mục sẽ được runner hiện tại thu thập. Live E2E vẫn chạy riêng theo config live.

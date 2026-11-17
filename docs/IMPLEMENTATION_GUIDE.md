# Hướng dẫn triển khai URL Shortener

Hướng dẫn Docker được duy trì tại [docker_integration.md](../docker_integration.md). Dùng tài liệu này làm nguồn chính cho toàn bộ kịch bản 11 phần; các ví dụ triển khai cũ không còn được lặp lại ở đây.

- Baseline đã có CRUD, redirect, expiration, click count, phân trang và Redis fallback.
- Nhánh thực hành: `feature/docker`. Tag đầu tiên: `seminar/00-local`, tiếp theo là `seminar/01-problem` đến `seminar/11-final`.
- Dependencies Python: sửa file `.in`, sinh lại cả hai lock `.txt` có SHA256; lệnh cụ thể nằm trong phần 0.6 của walkthrough và README.
- CI hiện có: [ci.yml](../.github/workflows/ci.yml). Workflow Docker smoke được hướng dẫn tạo ở phần 10, sau khi các file Docker đã sẵn sàng.
- Chọn checkpoint bằng [switch-tag.ps1](../scripts/switch-tag.ps1); script chỉ chuyển tới tag đã tồn tại, không tạo/fetch tag.

Xem [README](../README.md) để chạy local và [database design](DATABASE_DESIGN.md) để đọc schema hiện tại.

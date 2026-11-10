import random
import string

SHORT_CODE_LENGTH = 7

def generate_short_code(length: int = SHORT_CODE_LENGTH) -> str:
    """Sinh mã short_code ngẫu nhiên gồm các ký tự chữ và số với độ dài chuẩn."""
    characters = string.ascii_letters + string.digits
    return "".join(random.choice(characters) for _ in range(length))

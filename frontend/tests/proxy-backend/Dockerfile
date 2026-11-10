FROM python:3.13-alpine

WORKDIR /app
COPY proxy_backend.py .

USER 65534:65534
EXPOSE 8000

CMD ["python", "proxy_backend.py"]

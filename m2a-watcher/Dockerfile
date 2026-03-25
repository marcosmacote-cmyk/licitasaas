FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Set unbuffered output to see logs in real-time
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]

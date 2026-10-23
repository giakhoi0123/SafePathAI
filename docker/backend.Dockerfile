FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend backend
COPY data/osrm/README.md data/osrm/README.md
EXPOSE 8000

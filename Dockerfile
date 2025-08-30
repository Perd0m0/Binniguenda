# Imagen base oficial de Python 3.11
FROM python:3.11-slim

# Evitar buffers de Python
ENV PYTHONUNBUFFERED=1

# Directorio de trabajo
WORKDIR /app

# Copiar requirements.txt y luego instalar dependencias
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copiar toda la app
COPY . .

# Exponer el puerto que Cloud Run usará
ENV PORT=8080
EXPOSE 8080

# Comando para correr la app
CMD ["python", "app.py"]

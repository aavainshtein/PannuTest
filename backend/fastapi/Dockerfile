# Используем базовый образ Python 3.9
FROM python:3.9

# Установка рабочей директории
WORKDIR /code

# Копируем файл зависимостей
COPY requirements.txt /code/requirements.txt

# Устанавливаем зависимости
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Копируем исходный код приложения
COPY . /code

# Команда для запуска приложения
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
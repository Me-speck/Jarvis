# Base image with Python 3.8
FROM python:3.8-slim

# Set working directory
WORKDIR /app

# Copy the requirements.txt and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Expose the port on which the Flask app will run
EXPOSE 5000

# Run the application
CMD ["python", "app.py"]

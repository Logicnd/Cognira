# Cognira: Installation and Setup Script (PowerShell)

Write-Host "--- Cognira Installation ---" -ForegroundColor Cyan

# Check for Ollama
if (!(Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Ollama not found. Please install it from https://ollama.com/" -ForegroundColor Yellow
} else {
    Write-Host "Ollama found. Pulling default model (llama3)..." -ForegroundColor Green
    ollama pull llama3
}

# Python setup
Write-Host "Setting up Python virtual environment..." -ForegroundColor Cyan
if (!(Test-Path venv)) {
    python -m venv venv
}
.\venv\Scripts\activate
pip install -r api/requirements.txt

# Node setup
Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
npm install

Write-Host "--- Cognira Ready! ---" -ForegroundColor Green
Write-Host "Run 'npm run dev' to start the system." -ForegroundColor Cyan

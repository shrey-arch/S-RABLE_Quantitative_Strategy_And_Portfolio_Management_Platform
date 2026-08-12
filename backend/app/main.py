from fastapi import FastAPI

from app.config import settings

app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
)


@app.get("/")
def home():
    return {
        "message": f"Welcome to {settings.app_name}!"
    }
import os
import uvicorn

if __name__ == "__main__":
    host = os.getenv("UVICORN_HOST", "127.0.0.1")
    port = int(os.getenv("UVICORN_PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port)

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="::", port=8000)

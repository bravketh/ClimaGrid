from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"message": "ClimaGrid API is live!"}

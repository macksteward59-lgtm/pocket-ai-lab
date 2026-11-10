"""Loopback FastAPI app for non-executing governance review."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ai_integrator.api.health import router as health_router
from ai_integrator.api.routes import router as review_router
from ai_integrator.application.config_guard import assert_loopback_host, assert_runtime_config


def dashboard_dir() -> Path | None:
    override = os.environ.get("GOVERNANCE_DASHBOARD_DIR", "").strip()
    if override:
        path = Path(override)
        return path if path.is_dir() else None
    candidate = Path(__file__).resolve().parents[4] / "scripts" / "desktop" / "governance-dashboard"
    return candidate if candidate.is_dir() else None


def create_app() -> FastAPI:
    assert_runtime_config({
        "authorized": False,
        "execution_enabled": False,
        "live_probes": False,
        "mint_tokens": False,
        "cipher": "fernet",
        "host": os.environ.get("GOVERNANCE_SIDECAR_HOST", "127.0.0.1"),
    })
    app = FastAPI(
        title="Governance Review Sidecar",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _exc):
        return JSONResponse(status_code=422, content={"authorized": False, "error": "invalid review request"})

    @app.exception_handler(Exception)
    async def failed(_request, _exc):
        return JSONResponse(status_code=500, content={"authorized": False, "error": "review failed"})

    app.include_router(health_router)
    app.include_router(review_router)
    directory = dashboard_dir()
    if directory is not None:
        app.mount("/dashboard", StaticFiles(directory=directory, html=True), name="governance-dashboard")
    return app


app = create_app()


def main() -> None:
    import uvicorn

    host = assert_loopback_host(os.environ.get("GOVERNANCE_SIDECAR_HOST", "127.0.0.1"))
    port = int(os.environ.get("GOVERNANCE_SIDECAR_PORT", "8765"))
    if not 1 <= port <= 65535:
        raise SystemExit("GOVERNANCE_SIDECAR_PORT is invalid")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger(__name__)
_CTX_KEY = "sis_request_id"


def get_request_id(request: Request) -> str | None:
    return getattr(request.state, _CTX_KEY, None)


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        rid = request.headers.get("x-request-id") or request.headers.get("X-Request-Id")
        if not rid:
            rid = str(uuid.uuid4())
        setattr(request.state, _CTX_KEY, rid)
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response

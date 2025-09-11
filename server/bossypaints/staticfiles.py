from starlette.staticfiles import StaticFiles

class GzipFallbackStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        # Mark that StaticFiles handled the request at all
        resp.headers.setdefault("X-Served-By", "fastapi-static")

        if resp.status_code != 404:
            return resp

        gz_resp = await super().get_response(path + ".gz", scope)
        if gz_resp.status_code == 404:
            return resp  # still 404 from StaticFiles

        # Mark that our fallback fired
        gz_resp.headers["Content-Encoding"] = "gzip"
        gz_resp.headers.setdefault("Content-Type", "application/octet-stream")
        gz_resp.headers.setdefault("Cache-Control", "public, max-age=31536000")
        gz_resp.headers.setdefault("Access-Control-Allow-Origin", "*")
        gz_resp.headers.setdefault("Access-Control-Expose-Headers", "Content-Length, Content-Encoding, Accept-Ranges, ETag")
        gz_resp.headers["X-Served-By"] = "fastapi-gz-fallback"
        return gz_resp

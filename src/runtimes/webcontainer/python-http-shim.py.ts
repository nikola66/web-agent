/** Python source injected once at Pyodide init — kept in TS for test visibility. */
export const PYTHON_HTTP_SHIM = `
import urllib.request as _ur, ssl as _ssl, sys, json, types, os, base64
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl
from webagent_http_bridge import request as _bridge_request, uploadMultipart as _bridge_upload_multipart

class _FakeSSLCtx:
    check_hostname = False
    verify_mode = 0
    def load_verify_locations(self, *a, **kw): pass
    def load_cert_chain(self, *a, **kw): pass
_ssl.create_default_context = lambda *a, **kw: _FakeSSLCtx()

def _headers_from_bridge(val):
    if val is None:
        return {}
    to_py = getattr(val, "to_py", None)
    if callable(to_py):
        py = to_py()
        if isinstance(py, dict):
            return {str(k): str(v) for k, v in py.items()}
    if isinstance(val, dict):
        return {str(k): str(v) for k, v in val.items()}
    try:
        return {str(k): str(v) for k, v in dict(val).items()}
    except Exception:
        return {}

def _to_bytes(val):
    if val is None:
        return b""
    if isinstance(val, (bytes, bytearray)):
        return bytes(val)
    to_bytes = getattr(val, "to_bytes", None)
    if callable(to_bytes):
        return to_bytes()
    to_memoryview = getattr(val, "to_memoryview", None)
    if callable(to_memoryview):
        return bytes(to_memoryview())
    try:
        return bytes(val)
    except Exception:
        return str(val).encode("utf-8", errors="replace")

def _merge_params(url, params):
    if not params:
        return url
    parsed = urlparse(str(url))
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if isinstance(params, dict):
        query.update({str(k): str(v) for k, v in params.items()})
    else:
        query.update(dict(params))
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))

def _bridge_call(method, url, headers=None, body=None, body_encoding=None):
    result = _bridge_request(method, str(url), _headers_from_bridge(headers), body, body_encoding)
    if getattr(result, "error", None):
        raise OSError(str(result.error))
    status = int(getattr(result, "status", 0) or 0)
    body_bytes = _to_bytes(getattr(result, "bodyBytes", None))
    body_text = getattr(result, "bodyText", None)
    if not body_bytes and body_text:
        body_bytes = str(body_text).encode("utf-8", errors="replace")
    if body_text is None:
        body_text = body_bytes.decode("utf-8", errors="replace")
    hdrs = _headers_from_bridge(getattr(result, "headers", None))
    return status, hdrs, body_bytes, str(body_text)

def _bridge_multipart(url, headers, parts):
    result = _bridge_upload_multipart(str(url), _headers_from_bridge(headers), parts)
    if getattr(result, "error", None):
        raise OSError(str(result.error))
    status = int(getattr(result, "status", 0) or 0)
    body_bytes = _to_bytes(getattr(result, "bodyBytes", None))
    body_text = getattr(result, "bodyText", None)
    if not body_bytes and body_text:
        body_bytes = str(body_text).encode("utf-8", errors="replace")
    if body_text is None:
        body_text = body_bytes.decode("utf-8", errors="replace")
    hdrs = _headers_from_bridge(getattr(result, "headers", None))
    return status, hdrs, body_bytes, str(body_text)

class _ProxyResponse:
    def __init__(self, url, status, headers, body_bytes):
        self._url = str(url)
        self._status = int(status)
        self._headers = dict(headers or {})
        self._body = bytes(body_bytes or b"")
        self._pos = 0
    def read(self, amt=-1):
        if amt is None or amt < 0:
            chunk, self._pos = self._body[self._pos:], len(self._body)
        else:
            end = self._pos + int(amt)
            chunk, self._pos = self._body[self._pos:end], end
        return chunk
    def readall(self):
        return self.read()
    def readline(self, size=-1):
        if self._pos >= len(self._body):
            return b""
        nl = self._body.find(b"\\n", self._pos)
        if nl < 0:
            return self.read()
        end = nl + 1
        if size >= 0:
            end = min(end, self._pos + int(size))
        chunk = self._body[self._pos:end]
        self._pos = end
        return chunk
    def readlines(self, hint=-1):
        lines = []
        while True:
            line = self.readline()
            if not line:
                break
            lines.append(line)
            if hint >= 0 and len(lines) >= hint:
                break
        return lines
    def __iter__(self):
        return self
    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line
    def getcode(self):
        return self._status
    @property
    def status(self):
        return self._status
    @property
    def headers(self):
        return self._headers
    def geturl(self):
        return self._url
    def info(self):
        return self._headers
    def __enter__(self):
        return self
    def __exit__(self, *a):
        pass

def _patched_urlopen(url, data=None, timeout=None, **kwargs):
    kwargs.pop("context", None)
    method = "POST" if data is not None else "GET"
    req_url = url
    headers = {}
    body = None
    if isinstance(url, _ur.Request):
        req_url = url.full_url
        method = url.get_method()
        headers = dict(url.header_items())
        if data is None and url.data is not None:
            body = url.data
        else:
            body = data
    else:
        body = data
    if isinstance(body, (bytes, bytearray)):
        body = bytes(body).decode("latin-1")
    elif body is not None:
        body = str(body)
    status, hdrs, body_bytes, _text = _bridge_call(method, req_url, headers, body)
    return _ProxyResponse(req_url, status, hdrs, body_bytes)

_ur.urlopen = _patched_urlopen

class _HttpResponse:
    def __init__(self, status_code, text, content, headers, url):
        self.status_code = int(status_code)
        self.text = str(text)
        self.content = bytes(content or b"")
        self.headers = dict(headers or {})
        self.url = str(url)
    @property
    def ok(self):
        return 200 <= self.status_code < 300
    def json(self):
        return json.loads(self.text)

def _http_request(method, url, headers=None, params=None, json_body=None, data=None, timeout_ms=30000):
    del timeout_ms
    final_url = _merge_params(url, params)
    hdrs = _headers_from_bridge(headers)
    body = None
    if json_body is not None:
        body = json.dumps(json_body)
        hdrs.setdefault("Content-Type", "application/json")
    elif data is not None:
        if isinstance(data, (bytes, bytearray)):
            body = bytes(data).decode("latin-1")
        elif isinstance(data, str):
            body = data
        else:
            body = json.dumps(data)
    status, resp_headers, content, text = _bridge_call(method.upper(), final_url, hdrs, body)
    return _HttpResponse(status, text, content, resp_headers, final_url)

def _http_get(url, headers=None, params=None, timeout_ms=30000):
    return _http_request("GET", url, headers=headers, params=params, timeout_ms=timeout_ms)

def _http_post(url, json=None, data=None, headers=None, params=None, timeout_ms=30000):
    return _http_request("POST", url, headers=headers, params=params, json_body=json, data=data, timeout_ms=timeout_ms)

def _http_upload_file(url, path, field_name="file", filename=None, content_type=None, headers=None):
    p = str(path)
    if not os.path.isfile(p):
        raise OSError(f"upload_file: path not found: {p}")
    with open(p, "rb") as fh:
        raw = fh.read()
    fn = str(filename or os.path.basename(p))
    ct = str(content_type or "application/octet-stream")
    parts = [{"name": str(field_name), "filename": fn, "contentType": ct, "contentBase64": base64.b64encode(raw).decode("ascii")}]
    status, resp_headers, content, text = _bridge_multipart(url, headers, parts)
    return _HttpResponse(status, text, content, resp_headers, url)

def _http_post_multipart(url, fields=None, files=None, headers=None):
    parts = []
    for key, val in dict(fields or {}).items():
        parts.append({"name": str(key), "text": str(val)})
    for spec in list(files or []):
        if not isinstance(spec, dict):
            continue
        name = str(spec.get("name") or spec.get("field") or "file")
        fpath = spec.get("path") or spec.get("file_path")
        if not fpath:
            raise OSError("post_multipart file entry requires path")
        fpath = str(fpath)
        if not os.path.isfile(fpath):
            raise OSError(f"post_multipart: path not found: {fpath}")
        with open(fpath, "rb") as fh:
            raw = fh.read()
        parts.append({
            "name": name,
            "filename": str(spec.get("filename") or os.path.basename(fpath)),
            "contentType": str(spec.get("content_type") or spec.get("contentType") or "application/octet-stream"),
            "contentBase64": base64.b64encode(raw).decode("ascii"),
        })
    status, resp_headers, content, text = _bridge_multipart(url, headers, parts)
    return _HttpResponse(status, text, content, resp_headers, url)

_http_mod = types.ModuleType("webagent.http")
_http_mod.get = _http_get
_http_mod.post = _http_post
_http_mod.request = _http_request
_http_mod.upload_file = _http_upload_file
_http_mod.post_multipart = _http_post_multipart
sys.modules["webagent.http"] = _http_mod
if "webagent" not in sys.modules:
    sys.modules["webagent"] = types.ModuleType("webagent")
sys.modules["webagent"].http = _http_mod
`.trim();

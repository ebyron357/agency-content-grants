// Local stand-in for Render's TLS edge: HTTPS on 8443 -> HTTP on 8080, with X-Forwarded-Proto: https.
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
https.createServer({ key: fs.readFileSync(dir + "key.pem"), cert: fs.readFileSync(dir + "cert.pem") }, (req, res) => {
  const up = http.request({ host: "127.0.0.1", port: 8080, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502); res.end("upstream error: " + e.message); });
  req.pipe(up);
}).listen(8443, () => console.log("tls proxy on 8443"));

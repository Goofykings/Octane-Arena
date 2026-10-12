const fs = require("fs"),
  http = require("http"),
  path = require("path");
exports.staticGame = async (port = 8194) => {
  const root = path.resolve("dist");
  let apiRequests = 0;
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname.startsWith("/api")) apiRequests++;
    const file = path.resolve(
      root,
      pathname.replace(/^\/Octane-Arena\//, "").replace(/^\//, "") ||
        "index.html",
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${port}/Octane-Arena/?test`,
    apiRequests: () => apiRequests,
    close: () => new Promise((r) => server.close(r)),
  };
};

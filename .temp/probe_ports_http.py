import requests, urllib3
urllib3.disable_warnings()
for port in [888,8888,8443,2087,2096,3000,80,443,21631]:
    for scheme in ["https","http"]:
        url=f"{scheme}://43.242.194.115:{port}/"
        try:
            r=requests.get(url, verify=False, timeout=8, allow_redirects=False)
            print(url, r.status_code, r.headers.get("Server"), repr(r.text[:60]))
        except Exception as e:
            print(url, "ERR", type(e).__name__, str(e)[:80])

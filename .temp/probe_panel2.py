import requests, urllib3
urllib3.disable_warnings()
for scheme in ["https","http"]:
    for path in ["/", "/login", "/766cd832", "/favicon.ico"]:
        try:
            r=requests.get(f"{scheme}://43.242.194.115:21631"+path, verify=False, timeout=12, allow_redirects=False)
            print(scheme, path, r.status_code, dict(list(r.headers.items())[:6]), r.text[:120].replace("\n"," "))
        except Exception as e:
            print(scheme, path, "ERR", type(e).__name__, str(e)[:160])
print("--- cert ---")
import ssl, socket
try:
    ctx=ssl._create_unverified_context()
    with socket.create_connection(("43.242.194.115",21631), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname="43.242.194.115") as ss:
            print(ss.getpeercert())
except Exception as e:
    print("CERT ERR", e)

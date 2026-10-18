import socket, concurrent.futures, requests, urllib3, ssl
urllib3.disable_warnings()
HOST="43.242.194.115"
ports=[21,22,25,80,443,873,888,8888,8443,2087,2096,21631,3000,3306,5432,6379,7001,7002,8000,8080,8081,8088,8090,9000,9001,9090,9200,10000,11211,27017,28017,39000,40000,50000,55555,2222,22022,1022]
def check(p):
    s=socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST,p)); return p
    except Exception: return None
    finally: s.close()
open_ports=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=40) as ex:
    for r in ex.map(check, ports):
        if r: open_ports.append(r)
print("OPEN:", sorted(open_ports))
print("=== HTTPS fingerprint each open port ===")
ctx=ssl._create_unverified_context()
for p in sorted(open_ports):
    if p in (22,21,25,3306,5432,6379): continue
    try:
        with socket.create_connection((HOST,p), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=HOST) as ss:
                r=requests.get(f"https://{HOST}:{p}/login", verify=False, timeout=6, allow_redirects=False)
                print(p, "TLS", r.status_code, repr(r.text[:60]))
    except Exception as e:
        try:
            r=requests.get(f"http://{HOST}:{p}/login", timeout=6, allow_redirects=False)
            print(p, "HTTP", r.status_code, repr(r.text[:60]))
        except Exception as e2:
            print(p, "none", type(e).__name__)

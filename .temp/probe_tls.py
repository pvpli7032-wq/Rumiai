import ssl, socket, json
ctx=ssl._create_unverified_context()
for port in [21631, 8888, 8443, 888, 443]:
    try:
        with socket.create_connection(("43.242.194.115",port), timeout=8) as sock:
            with ctx.wrap_socket(sock, server_hostname="43.242.194.115") as ss:
                cert=ss.getpeercert()
                print(port, "TLS ok", cert.get("subject"), cert.get("issuer",[[]])[0][:1] if cert.get("issuer") else None, ss.version())
    except Exception as e:
        print(port, "no TLS", type(e).__name__, str(e)[:80])
print("--- http probes with Host ---")
import http.client
for port in [8888, 8443, 888, 80]:
    try:
        conn=http.client.HTTPConnection("43.242.194.115", port, timeout=8)
        conn.request("GET","/",headers={"Host":"43.242.194.115:%d"%port})
        r=conn.getresponse(); body=r.read(300)
        print(port, r.status, r.getheader("Server"), body[:100])
    except Exception as e:
        print(port,"ERR",type(e).__name__,str(e)[:80])

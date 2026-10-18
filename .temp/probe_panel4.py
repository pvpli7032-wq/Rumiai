import socket, ssl, requests, urllib3
urllib3.disable_warnings()
print("=== egress ip (direct) ===")
try:
    r=requests.get("http://ip-api.com/json/?fields=query,country,city,isp", timeout=15)
    print(r.text)
except Exception as e: print("ERR", e)
print("=== TLS cert on 21631 ===")
ctx=ssl._create_unverified_context()
try:
    with socket.create_connection(("43.242.194.115",21631), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname="43.242.194.115") as ss:
            der=ss.getpeercert(binary_form=True)
            import ssl as s2
            info=s2._ssl._test_decode_cert
            open(".temp/c.pem","wb").write(ssl.DER_cert_to_PEM_cert(der).encode())
            print("cert saved", len(der))
except Exception as e:
    print("CERT ERR", type(e).__name__, e)
print("=== 21631 full headers ===")
r=requests.get("https://43.242.194.115:21631/766cd832", verify=False, timeout=10)
print(r.status_code, dict(r.headers))
print("=== try POST login ===")
r=requests.post("https://43.242.194.115:21631/login", data={"username":"xvbkiqus","password":"c9be5189"}, verify=False, timeout=15)
print(r.status_code, r.text[:300])

import socket, requests, urllib3, paramiko
urllib3.disable_warnings()
print("=== egress ===")
try: print(requests.get("http://ip-api.com/json/?fields=query,city,isp", timeout=15).text)
except Exception as e: print("ERR", e)
print("=== ssh ===")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect("43.242.194.115",22,"root","kddsXOLC9832",timeout=20,allow_agent=False,look_for_keys=False)
    print("SSH OK")
    i,o,e=c.exec_command("hostname; uname -a; date; ls /www/wwwroot")
    print(o.read().decode())
    c.close()
except Exception as ex:
    print("SSH ERR", type(ex).__name__, str(ex)[:200])
print("=== panel ===")
for path in ["/766cd832","/"]:
    try:
        r=requests.get("https://43.242.194.115:21631"+path, verify=False, timeout=20, allow_redirects=False)
        print(path, r.status_code, len(r.content), r.text[:150].replace("\n"," "))
    except Exception as ex:
        print(path,"ERR",type(ex).__name__,str(ex)[:120])

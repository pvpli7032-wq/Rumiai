import requests, urllib3, paramiko, socket
urllib3.disable_warnings()
print("=== SSH retry ===")
for pwd in ["kddsXOLC9832"]:
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect("43.242.194.115",22,"root",pwd,timeout=20,allow_agent=False,look_for_keys=False)
        print("SSH OK")
        i,o,e=c.exec_command("hostname; ls /www/wwwroot")
        print(o.read().decode()); c.close()
    except Exception as ex:
        print("SSH ERR", type(ex).__name__, str(ex)[:120])
print("=== panel host variations ===")
hosts=["43.242.194.115:21631","lh.y-98.cn","www.lh.y-98.cn","panel.y-98.cn","bt.y-98.cn","43.242.194.115"]
for h in hosts:
    try:
        r=requests.get("https://43.242.194.115:21631/766cd832", verify=False, timeout=8, headers={"Host":h}, allow_redirects=False)
        print(h, r.status_code, repr(r.text[:50]))
    except Exception as e:
        print(h,"ERR",type(e).__name__,str(e)[:60])
print("=== panel root variants ===")
for p in ["/","/login","/766cd832/","/766cd832/index.html","/766cd832/login","//766cd832"]:
    try:
        r=requests.get("https://43.242.194.115:21631"+p, verify=False, timeout=8, allow_redirects=False)
        print(p, r.status_code, repr(r.text[:50]))
    except Exception as e:
        print(p,"ERR",type(e).__name__,str(e)[:60])

import requests, urllib3, json
urllib3.disable_warnings()
P={"https":"http://127.0.0.1:7890","http":"http://127.0.0.1:7890"}
print("=== egress via proxy ===")
try:
    print(requests.get("https://api.ipify.org?format=json", proxies=P, timeout=20).text)
except Exception as e: print("ERR", e)
print("=== panel via proxy ===")
for path in ["/766cd832","/","/login"]:
    try:
        r=requests.get("https://43.242.194.115:21631"+path, proxies=P, verify=False, timeout=20, allow_redirects=False)
        print(path, r.status_code, len(r.content), r.text[:100].replace("\n"," "))
    except Exception as e:
        print(path,"ERR",type(e).__name__,str(e)[:100])
print("=== site via proxy ===")
try:
    r=requests.get("https://lh.y-98.cn/admin", proxies=P, verify=False, timeout=20, allow_redirects=False)
    print(r.status_code, len(r.content))
except Exception as e: print("ERR", e)

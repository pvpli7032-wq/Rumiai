import requests, urllib3
urllib3.disable_warnings()
r=requests.get("https://43.242.194.115:443/", verify=False, timeout=15)
print(r.status_code, r.headers.get("Server"), r.headers.get("Content-Type"))
print(r.text[:1500])
print("=== 21631 with /766cd832 login POST test ===")
s=requests.Session()
r2=s.get("https://43.242.194.115:21631/766cd832", verify=False, timeout=10)
print(r2.status_code, r2.text[:200])

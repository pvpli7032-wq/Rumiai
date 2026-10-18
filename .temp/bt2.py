import requests, urllib3, pickle
urllib3.disable_warnings()
BASE="https://43.242.194.115:21631"
TOKEN="EBhVAyKzdkDV7ZHa63bxT1B81lgWAiWz05XnqNxekjs7OVNk"
s=requests.Session()
r=s.get(BASE+"/login?tmp_token="+TOKEN, verify=False, timeout=25, allow_redirects=False)
print("status", r.status_code, "len", len(r.content))
print("cookies", s.cookies.get_dict())
if r.status_code==200:
    pickle.dump(s.cookies, open(".temp/bt_cookies.pkl","wb"))
    r2=s.post(BASE+"/system?action=GetSystemTotal", timeout=20, verify=False)
    print("system", r2.status_code, r2.text[:400])

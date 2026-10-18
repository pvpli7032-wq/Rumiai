import requests, urllib3, json, pickle, os, sys
urllib3.disable_warnings()
BASE="https://43.242.194.115:21631"
TOKEN="EBhVAyKzdkDV7ZHa63bxT1B81lgWAiWz05XnqNxekjs7OVNk"
CJ=".temp/bt_cookies.pkl"

def login():
    s=requests.Session()
    r=s.get(BASE+"/login?tmp_token="+TOKEN, verify=False, timeout=25)
    if r.status_code!=200 or "宝塔" not in r.text and "Linux" not in r.text:
        print("login page status", r.status_code)
    pickle.dump(s.cookies, open(CJ,"wb"))
    return s

def sess():
    s=requests.Session()
    if os.path.exists(CJ):
        s.cookies.update(pickle.load(open(CJ,"rb")))
    return s

if __name__=="__main__":
    mode=sys.argv[1]
    s = login() if mode=="login" else sess()
    if mode=="login":
        r=s.post(BASE+"/system?action=GetSystemTotal", timeout=20, verify=False)
        print("system:", r.status_code, r.text[:300])
        r=s.post(BASE+"/site?action=GetSiteList", data={"p":1,"limit":20,"type":-1}, timeout=20, verify=False)
        print("sites:", r.status_code, r.text[:800])

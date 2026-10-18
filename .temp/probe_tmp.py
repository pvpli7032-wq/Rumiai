import requests, urllib3
urllib3.disable_warnings()
url="https://43.242.194.115:21631/login?tmp_token=EBhVAyKzdkDV7ZHa63bxT1B81lgWAiWz05XnqNxekjs7OVNk"
s=requests.Session()
r=s.get(url, verify=False, timeout=20, allow_redirects=True)
print("STATUS", r.status_code, "URL", r.url, "LEN", len(r.content))
print("HEADERS", dict(list(r.headers.items())[:8]))
print("BODY:", r.text[:1200])
print("COOKIES:", s.cookies.get_dict())

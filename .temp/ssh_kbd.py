import paramiko, socket
HOST="43.242.194.115"
def try_auth(user, pwd, mode):
    t=paramiko.Transport((HOST,22)); t.start_client(timeout=15)
    try:
        if mode=="password":
            t.auth_password(user, pwd)
        else:
            t.auth_interactive(user, lambda title, instr, fields: [pwd for f in fields])
        print("OK", user, mode, t.is_authenticated())
        return True
    except Exception as e:
        print("FAIL", user, mode, type(e).__name__, str(e)[:80])
        return False
    finally:
        t.close()
for user in ["root","ubuntu","admin"]:
    for mode in ["password","interactive"]:
        try_auth(user, "kddsXOLC9832", mode)

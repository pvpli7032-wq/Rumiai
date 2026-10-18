import socket, paramiko, sys
HOST="43.242.194.115"
s=socket.create_connection((HOST,22), timeout=10)
print("BANNER:", s.recv(200).decode(errors="replace").strip())
s.close()
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(HOST, 22, "root", "kddsXOLC9832", timeout=15, allow_agent=False, look_for_keys=False)
    print("PASSWORD OK")
except Exception as e:
    print("PWD ERR:", type(e).__name__, e)
    # inspect offered methods
    t=paramiko.Transport((HOST,22)); t.start_client(timeout=15)
    try:
        t.auth_none("root")
    except paramiko.BadAuthenticationType as b:
        print("ALLOWED:", b.allowed_types)
    except Exception as e2:
        print("NONE ERR", type(e2).__name__, e2)
    t.close()

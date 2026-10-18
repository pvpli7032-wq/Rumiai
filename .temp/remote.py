import sys, os, time
import paramiko

HOST = "43.242.194.115"
PORT = 22
USER = "root"
PWD = "1314520Gao..."

def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PWD, timeout=25, banner_timeout=30, auth_timeout=30)
    return c

def run(cmd, timeout=180):
    c = connect()
    chan = c.get_transport().open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    out = b""
    while True:
        if chan.recv_ready():
            out += chan.recv(65536)
        elif chan.recv_stderr_ready():
            out += chan.recv_stderr(65536)
        elif chan.exit_status_ready():
            while chan.recv_ready():
                out += chan.recv(65536)
            while chan.recv_stderr_ready():
                out += chan.recv_stderr(65536)
            break
        else:
            time.sleep(0.03)
    code = chan.recv_exit_status()
    c.close()
    return out, code

def download(remote, local):
    c = connect()
    chan = c.get_transport().open_session()
    chan.settimeout(600)
    chan.exec_command("cat " + remote)
    with open(local, "wb") as f:
        while True:
            if chan.recv_ready():
                f.write(chan.recv(262144))
            elif chan.exit_status_ready():
                while chan.recv_ready():
                    f.write(chan.recv(262144))
                break
            else:
                time.sleep(0.02)
    code = chan.recv_exit_status()
    c.close()
    return code

def upload(local, remote):
    c = connect()
    chan = c.get_transport().open_session()
    chan.settimeout(600)
    chan.exec_command("cat > " + remote)
    with open(local, "rb") as f:
        while True:
            chunk = f.read(262144)
            if not chunk:
                break
            chan.sendall(chunk)
    chan.shutdown_write()
    code = chan.recv_exit_status()
    c.close()
    return code

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "run":
        out, code = run(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 180)
        sys.stdout.buffer.write(out)
        sys.stdout.buffer.write(("\n__EXIT__%d\n" % code).encode())
    elif mode == "get":
        print("GET exit", download(sys.argv[2], sys.argv[3]))
    elif mode == "put":
        print("PUT exit", upload(sys.argv[2], sys.argv[3]))

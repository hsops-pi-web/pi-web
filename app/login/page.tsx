"use client";

import { useState } from "react";
import { USERNAME_RE, PASSWORD_RE } from "@/lib/auth/validate";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [gatePassed, setGatePassed] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submitGate() {
    setMsg(null);
    const res = await fetch("/api/auth/register-gate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    if (res.ok) setGatePassed(true);
    else setMsg("注册关键词错误");
  }

  async function submitRegister() {
    setMsg(null);
    if (!USERNAME_RE.test(username)) return setMsg("用户名：字母开头，仅字母和数字");
    if (!PASSWORD_RE.test(password)) return setMsg("密码：至少8位，含大小写字母和数字");
    const res = await fetch("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword, username, password }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("注册成功，请登录"); setMode("login"); setPassword(""); }
    else setMsg(data.error ?? "注册失败");
  }

  async function submitLogin() {
    setMsg(null);
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) window.location.href = "/";
    else setMsg("用户名或密码错误");
  }

  const inputStyle = {
    width: "100%", marginBottom: 8, padding: "6px 8px",
    background: "var(--bg-panel)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: 4, fontSize: 13,
    boxSizing: "border-box" as const,
  } as const;
  const btnStyle = {
    padding: "6px 12px", background: "var(--accent)", color: "#fff",
    border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13,
  } as const;

  return (
    <div style={{
      maxWidth: 360, margin: "80px auto", padding: 24,
      background: "var(--bg-panel)", border: "1px solid var(--border)",
      borderRadius: 8, color: "var(--text)",
    }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => { setMode("login"); setMsg(null); }}
          disabled={mode === "login"}
          style={{ ...btnStyle, background: mode === "login" ? "var(--accent)" : "var(--bg-hover)", color: mode === "login" ? "#fff" : "var(--text-dim)" }}
        >登录</button>
        <button
          onClick={() => { setMode("register"); setMsg(null); }}
          disabled={mode === "register"}
          style={{ ...btnStyle, background: mode === "register" ? "var(--accent)" : "var(--bg-hover)", color: mode === "register" ? "#fff" : "var(--text-dim)" }}
        >注册</button>
      </div>

      {mode === "register" && !gatePassed ? (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>注册关键词</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={inputStyle}
          />
          <button onClick={submitGate} style={btnStyle}>验证关键词</button>
        </div>
      ) : (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>用户名</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
          />
          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>密码</label>
          <div style={{ position: "relative" }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
            {mode === "register" && (
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: -4, marginBottom: 8 }}>
                至少 8 位，含大小写字母和数字
              </div>
            )}
          </div>
          <button
            onClick={mode === "login" ? submitLogin : submitRegister}
            style={{ ...btnStyle, marginTop: 8 }}
          >
            {mode === "login" ? "登录" : "提交注册"}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 12, color: "#e5484d", fontSize: 13 }}>{msg}</div>
      )}
    </div>
  );
}

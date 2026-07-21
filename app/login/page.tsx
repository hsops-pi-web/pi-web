"use client";

import { useState } from "react";
import { USERNAME_RE, PASSWORD_RE } from "@/lib/auth/validate";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [gatePassed, setGatePassed] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
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

  function submit() {
    if (mode === "register" && !gatePassed) submitGate();
    else if (mode === "login") submitLogin();
    else submitRegister();
  }

  const isError = msg !== null && msg !== "注册成功，请登录";

  return (
    <div style={S.page} className="login-page">
      <div style={S.card}>
        <div style={S.brand}>
          <span style={S.logo}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" /><path d="M5 6h6M5 9h4" />
            </svg>
          </span>
          <h1 style={S.brandName}>pi-web</h1>
        </div>
        <p style={S.subtitle}>登录后进入你的专属工作区</p>

        <div style={S.tabs}>
          <button
            style={{ ...S.tab, ...(mode === "login" ? S.tabActive : {}) }}
            onClick={() => { setMode("login"); setMsg(null); }}
          >登录</button>
          <button
            style={{ ...S.tab, ...(mode === "register" ? S.tabActive : {}) }}
            onClick={() => { setMode("register"); setMsg(null); }}
          >注册</button>
        </div>

        {mode === "register" && !gatePassed ? (
          <>
            <div style={S.field}>
              <div style={S.label}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1l6 3v4c0 3.5-2.5 6-6 7-3.5-1-6-3.5-6-7V4z" /></svg>
                注册关键词
              </div>
              <div style={S.inputWrap}>
                <input
                  style={S.input}
                  value={keyword}
                  placeholder="输入邀请关键词"
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={S.field}>
              <div style={S.label}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5" r="3" /><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /></svg>
                用户名
              </div>
              <div style={S.inputWrap}>
                <input
                  style={S.input}
                  value={username}
                  placeholder={mode === "register" ? "仅字母和数字，字母开头" : "用户名"}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
            </div>

            <div style={S.field}>
              <div style={S.label}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
                密码
              </div>
              <div style={S.inputWrap}>
                <input
                  style={S.input}
                  type={showPw ? "text" : "password"}
                  value={password}
                  placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <button style={S.togglePw} onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "隐藏密码" : "显示密码"}>
                  {showPw ? (
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="2" /><line x1="2" y1="14" x2="14" y2="2" /></svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="2" /></svg>
                  )}
                </button>
              </div>
              {mode === "register" && (
                <div style={S.hint}>至少 8 位，含大小写字母和数字</div>
              )}
            </div>
          </>
        )}

        <button style={S.btn} onClick={submit}>
          {mode === "login" ? "登 录" : gatePassed ? "提交注册" : "验证关键词"}
        </button>

        <div style={{ ...S.msg, color: isError ? "var(--err, #f87171)" : "var(--accent)" }}>
          {msg ?? ""}
        </div>

        <div style={S.foot}>
          按 <kbd style={S.kbd}>Enter</kbd> 提交
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--bg)", color: "var(--text)",
    backgroundImage:
      "radial-gradient(600px 400px at 30% 20%, rgba(96,165,250,0.05), transparent 70%), radial-gradient(500px 500px at 80% 90%, rgba(96,165,250,0.03), transparent 70%)",
  },
  card: {
    width: 380, padding: "40px 36px",
    background: "var(--bg-panel)", border: "1px solid var(--border)",
    borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.20)",
  },
  brand: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  logo: {
    width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "var(--accent)", flex: "0 0 auto",
  },
  brandName: { fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 12, color: "var(--text-dim)", margin: "0 0 28px 42px", letterSpacing: "0.02em" },
  tabs: { display: "flex", gap: 4, marginBottom: 24, background: "var(--bg)", padding: 4, borderRadius: 8 },
  tab: {
    flex: 1, padding: "8px 0", textAlign: "center", fontSize: 13, cursor: "pointer",
    border: "none", background: "none", color: "var(--text-dim)", borderRadius: 6,
    fontFamily: "inherit", transition: "all .15s ease",
  },
  tabActive: { background: "var(--bg-selected)", color: "var(--text)" },
  field: { marginBottom: 16 },
  label: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", marginBottom: 6 },
  inputWrap: { position: "relative" },
  input: {
    width: "100%", height: 40, padding: "0 12px", boxSizing: "border-box",
    background: "var(--bg)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: 6,
    fontSize: 13, fontFamily: "inherit", outline: "none",
  },
  togglePw: {
    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
    background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer",
    padding: 4, display: "flex",
  },
  hint: { fontSize: 11, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.5 },
  btn: {
    width: "100%", height: 42, marginTop: 8,
    background: "var(--accent)", color: "#0d1117",
    border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em",
  },
  msg: { marginTop: 14, fontSize: 12, minHeight: 16, textAlign: "center" },
  foot: { marginTop: 22, textAlign: "center", fontSize: 11, color: "var(--text-dim)" },
  kbd: {
    fontSize: 10, padding: "2px 5px", border: "1px solid var(--border)",
    borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)",
  },
};

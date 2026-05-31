//! P11-D `git-ai whoami` Tauri 命令层。
//!
//! 暴露:
//! - `get_whoami()` → 当前 git-ai 登录态结构化快照
//!
//! 诊断页 quickFix「whoami-error」规则用它判断 token 是否失效(登录态=诊断项,非登录 UI)。
//!
//! # 跨锁
//! whoami 只读,与 install / hooks / mock 三锁**无关**:不写 settings.json,不动 git notes,
//! 不阻塞其它操作。

use serde::{Deserialize, Serialize};

use crate::git_ai;
use crate::git_ai::auth::WhoamiPayload;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthDegradedReason {
    GitAiMissing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WhoamiResult {
    // WhoamiPayload 较大(>= 264B,含多个 Option<String> 和 orgs Vec),
    // 用 Box 缩减 enum 整体尺寸(clippy::large_enum_variant)。
    // serde 对 Box<T> 透明,TS 端契约不变。
    Ok { payload: Box<WhoamiPayload> },
    Degraded { reason: AuthDegradedReason },
}

#[tauri::command]
pub async fn get_whoami() -> Result<WhoamiResult, String> {
    let bin = match git_ai::binary::resolve() {
        Ok(p) => p,
        Err(_) => {
            return Ok(WhoamiResult::Degraded {
                reason: AuthDegradedReason::GitAiMissing,
            });
        }
    };
    let payload = git_ai::auth::run_whoami(&bin)
        .await
        .map_err(|e| e.to_string())?;
    Ok(WhoamiResult::Ok {
        payload: Box::new(payload),
    })
}

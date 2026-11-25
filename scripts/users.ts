/**
 * Account administration from the command line: the first admin, and recovery
 * when nobody can sign in. Prints one-time links; never prints or takes passwords.
 *
 *   npm run users -- list
 *   npm run users -- invite --email a@b.org --name "Ana Silva" --role admin|reviewer|viewer
 *   npm run users -- link --email a@b.org          # new invite / password-reset link
 *   npm run users -- role --email a@b.org --role reviewer
 *   npm run users -- disable --email a@b.org
 *   npm run users -- enable --email a@b.org
 *
 * Links use APP_ORIGIN (hosted) or http://localhost:3000.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { AccountError, inviteUser, LINK_TTL_MS, listUsers, newPasswordLink, setDisabled, setRole, userByEmail, type Role } from "../src/lib/auth/accounts";
import { passwordLinkUrl } from "../src/lib/auth/links";
import { defaultDataDir } from "../src/lib/data/load";
import { pipelineDb } from "../src/lib/pipeline/db";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const actor = `cli:${os.userInfo().username}`;

function need(name: string): string {
  const v = opt(name);
  if (!v) throw new AccountError(`missing --${name}`);
  return v;
}

function find(email: string) {
  const u = userByEmail(pipelineDb(), email);
  if (!u) throw new AccountError(`no account for ${email}`);
  return u;
}

function main() {
  const db = pipelineDb(defaultDataDir());
  switch (cmd) {
    case "list": {
      const users = listUsers(db);
      if (!users.length) console.log("No accounts yet. Create the first admin with: npm run users -- invite --email … --name … --role admin");
      for (const u of users) {
        const state = u.disabled_at ? "disabled" : !u.password_hash ? "invite not used" : `last sign-in ${u.last_login_at?.slice(0, 16) ?? "never"}`;
        console.log(`${String(u.id).padStart(3)}  ${u.role.padEnd(8)} ${u.email.padEnd(32)} ${u.name.padEnd(24)} ${state}`);
      }
      return;
    }
    case "invite": {
      const { user, token } = inviteUser(db, { email: need("email"), name: need("name"), role: need("role") as Role }, actor);
      console.log(`Created ${user.role} account for ${user.name} <${user.email}>.`);
      console.log(`One-time link (valid ${LINK_TTL_MS.invite / 3600_000} hours, works once):\n\n  ${passwordLinkUrl(token)}\n`);
      return;
    }
    case "link": {
      const u = find(need("email"));
      const { purpose, token } = newPasswordLink(db, u.id, actor);
      console.log(`${purpose === "reset" ? "Password-reset" : "Invite"} link for ${u.email} (valid ${LINK_TTL_MS[purpose] / 3600_000} hours, works once${purpose === "reset" ? "; existing sessions were ended" : ""}):\n\n  ${passwordLinkUrl(token)}\n`);
      return;
    }
    case "role":
      setRole(db, find(need("email")).id, need("role") as Role, actor);
      console.log("Role changed.");
      return;
    case "disable":
    case "enable":
      setDisabled(db, find(need("email")).id, cmd === "disable", actor);
      console.log(`Account ${cmd}d.`);
      return;
    default:
      console.log("Usage: npm run users -- list | invite --email --name --role | link --email | role --email --role | disable --email | enable --email");
      process.exitCode = cmd ? 1 : 0;
  }
}

try {
  main();
} catch (e) {
  if (e instanceof AccountError) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

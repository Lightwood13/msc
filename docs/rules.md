# MSC lint rules

Each rule has a stable six-long alphanumeric code used in diagnostics and in `# msc-ignore` comments. When highlighting an error, VSCode links to the section below for more information.

## Ignore comments

To suppress a rule, use `# msc-ignore` comments:

| Comment | Effect |
|---|---|
| `# msc-ignore` | Suppress all rules on the next non-blank, non-comment line |
| `# msc-ignore CODE [CODE...]` | Suppress listed rules on the next non-blank, non-comment line |
| `# msc-ignore file` | Suppress all rules across the whole file |
| `# msc-ignore file CODE [CODE...]` | Suppress listed rules across the whole file |

`any` and `all` are accepted as filler and treated as "all rules": `# msc-ignore any` is equivalent to `# msc-ignore`.

The three quick-fix actions on every diagnostic are:

- **Ignore this error** inserts `# msc-ignore <CODE>` on the line above.
- **Ignore this error and others like it** inserts `# msc-ignore file <CODE>` at the top of the file.
- **Disable error checking in this file** inserts `# msc-ignore file` at the top of the file.

## Types of rule

There are five categories of rule.

- **LEX** rules are *lexical*: these occur when the source can't be parsed, processed or tokenised correctly.
- **SYN** rules are *syntactical*: these govern code which is invalid due to the language, like providing the incorrect parameters to script operators.
- **SEM** rules are *semantic*: these govern code which are problematic given the contets of your codebase, such as passing arguments of the incorrect type to a function.
- **SEC** rules are *security*: these highlights represent features the MSC interpreter refuses to run to prevent crashes or exploits.
- **STY** rules are *stylistic*: this is for warnings, conventions or recommendations about best practices.

## Glossary of rules

<a id="syn001"></a>
### SYN001: unclosed-if (syntax error)

Every `@if` must be closed with `@fi` before the script ends. The diagnostic points at the unclosed opener.

```msc
# bad
@if {{x > 0}}
    @command /say hi

# good
@if {{x > 0}}
    @command /say hi
@fi
```

The quick fix appends `@fi` at end of file. If the missing `@fi` belongs somewhere in the middle of a longer file, prefer placing it manually rather than accepting the auto-fix.

---

<a id="syn002"></a>
### SYN002: unclosed-for (syntax error)

Every `@for` must be closed with `@done` before the script ends. The diagnostic points at the unclosed opener.

```msc
# bad
@for Player p in {{onlinePlayers}}
    @command /say hi {{p.name}}

# good
@for Player p in {{onlinePlayers}}
    @command /say hi {{p.name}}
@done
```

The quick fix appends `@done` at end of file. As with `SYN001`, prefer placing it manually if the missing closer belongs mid-file.

---

<a id="syn003"></a>
### SYN003: invalid-script-option (syntax error)

The first word of a non-comment line must be a recognised script operator (`@if`, `@for`, `@command`, `@delay`, etc.).

```msc
# bad
@iff condition
```

---

<a id="sec001"></a>
### SEC001: bypass-script-banned (security error)

`@bypass /script` or `@console /script` allowed scripts to call other scripts unsupervised. The MSC compiler now rejects it for security reasons. Use `@command /script` instead: this has the same effect when the script is run by an operator, but is subject to permission checks otherwise.

```msc
# bad
@bypass /script run someNs::someFunc()

# good
@command /script run someNs::someFunc()
```

The quick fix substitutes `@command` for `@bypass` or `@console` on the offending line.

---

<a id="sec002"></a>
### SEC002: permission-commands-banned (security error)

Permission-changing commands are blocked in scripts whether invoked via `@bypass`, `@console`, or `@command`. This covers the vanilla `/op` and `/deop`, the rank command `/rank`, and the LuckPerms aliases (`/lp`, `/luckperms`, `/permission`, `/perm`, `/perms`).

```msc
# bad
@bypass /op someone
@console /lp user someone permission set group.admin true
```

The quick fix deletes the offending line. Granting permissions from a script is by design impossible. You should issue these commands manually as an admin if you need them.

---

<a id="sec003"></a>
### SEC003: chat-commands-banned (security error)

Scripts cannot run chat commands. This covers `/chat`, `/gchat`, `/echat`, `/achat`, `/schat`, `/bchat`, `/pchat`, `/tchat`, `/alert`, `/p`, and `/t`, regardless of executor.

```msc
# bad
@command /chat hello
@bypass /alert important
```

The quick fix deletes the offending line.

---

<a id="sec004"></a>
### SEC004: dynamic-commands-banned (security error)

The command name in `@bypass`, `@console`, or `@command` cannot start with a `{{...}}` expression to prevent running arbitrary commands based on potentially untrusted user input.

```msc
# bad
@command /{{commandName}} arg1
@bypass {{cmd}}
```

The quick fix deletes the offending line.


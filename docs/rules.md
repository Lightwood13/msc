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
@if x > 0
    @command /say hi

# good
@if x > 0
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
@for Player p in onlinePlayers
    @command /say hi {{p.name}}

# good
@for Player p in onlinePlayers
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

<a id="syn004"></a>
### SYN004: operator-must-be-alone (syntax error)

`@else`, `@fi`, `@done`, `@cancel`, `@slow`, and `@fast` cannot have anything after them on the same line.

```msc
# bad
@fi some trailing junk

# good
@fi
```

The quick fix removes the trailing content.

---

<a id="syn005"></a>
### SYN005: empty-condition (syntax error)

`@if` and `@elseif` must be followed by a non-empty condition.

```msc
# bad
@if

# good
@if player.isOp()
```

---

<a id="syn006"></a>
### SYN006: for-syntax (syntax error)

`@for` must use the form `@for <type> <variable> in <list>`.

```msc
# bad
@for Player in onlinePlayers

# good
@for Player p in onlinePlayers
```

---

<a id="syn007"></a>
### SYN007: define-syntax (syntax error)

`@define` must use the form `@define <type> <variable> [= <expression>]`.

```msc
# bad
@define String

# good
@define String name = "Minr"
```

---

<a id="syn008"></a>
### SYN008: empty-initializer (syntax error)

If `@define` includes `=`, it must be followed by an initializer expression.

```msc
# bad
@define Int count =

# good
@define Int count = 0
```

---

<a id="syn009"></a>
### SYN009: chatscript-syntax (syntax error)

`@chatscript` must use the form `@chatscript <time> <group-name> <expression>`.

```msc
# bad
@chatscript 10s group

# good
@chatscript 10s group doStuff()
```

---

<a id="syn010"></a>
### SYN010: invalid-time (syntax error)

Time values must be a number, optionally followed by one of these units: `s`, `m`, `h`, `d`, `w`, or `y`.

```msc
# bad
@delay 10t

# good
@delay 10s
```

---

<a id="syn011"></a>
### SYN011: prompt-syntax (syntax error)

`@prompt` must use the form `@prompt <time> <variable> [expiration-message]`.

```msc
# bad
@prompt 10s

# good
@prompt 10s name Prompt expired
```

---

<a id="syn012"></a>
### SYN012: cooldown-syntax (syntax error)

`@cooldown` and `@global_cooldown` must be followed by a single time argument.

```msc
# bad
@cooldown

# good
@cooldown 30s
```

---

<a id="syn013"></a>
### SYN013: delay-syntax (syntax error)

`@delay` must be followed by a single time argument.

```msc
# bad
@delay

# good
@delay 1s
```

---

<a id="syn014"></a>
### SYN014: using-syntax (syntax error)

`@using` must use the form `@using <namespace>`.

```msc
# bad
@using

# good
@using myNamespace
```

---

<a id="syn015"></a>
### SYN015: command-operator-syntax (syntax error)

`@bypass`, `@command`, and `@console` must be followed by a command payload.

```msc
# bad
@command

# good
@command /say hi
```

---

<a id="syn016"></a>
### SYN016: unmatched-block-end (syntax error)

`@fi` and `@done` must each close a matching opener.

```msc
# bad
@done

# good
@for Player p in onlinePlayers
@done
```

---

<a id="syn017"></a>
### SYN017: mismatched-block-end (syntax error)

Use `@fi` to close `@if`, and `@done` to close `@for`.

```msc
# bad
@if x
@done

# good
@if x
@fi
```

---

<a id="syn018"></a>
### SYN018: unmatched-else (syntax error)

`@else` and `@elseif` can only appear inside an `@if` block.

```msc
# bad
@else

# good
@if x
@else
@fi
```

---

<a id="syn019"></a>
### SYN019: multiple-else (syntax error)

An `@if` block can have at most one `@else`, and no `@elseif` may appear after it.

```msc
# bad
@if x
@else
@elseif y
@fi
```

---

<a id="syn020"></a>
### SYN020: header-operator-placement (syntax error)

`@cooldown`, `@global_cooldown`, and `@cancel` must appear in the script header, before executable statements.

```msc
# bad
@command /say hi
@cooldown 10s

# good
@cooldown 10s
@command /say hi
```

---

<a id="syn021"></a>
### SYN021: duplicate-return (syntax error)

Two `@return` statements cannot appear in the same conditional clause.

```msc
# bad
@if x
@return
@return
@fi
```

---

<a id="sem001"></a>
### SEM001: invalid-operator-types (semantic error)

An operator must be valid for the types on either side of it. The resolver mirrors the server's `@Operation` overloads: dispatch is on the left-hand type only, with no implicit numeric promotion or operator commutativity.

```msc
# bad
@return true + false
@player {{loc + " is the spawn"}}    # Location has no `+ String`
@var v3 = vec3 * 2                    # Vector3 needs Double, not Int

# good
@return 1 + 2
@var concat = "Score: " + 42
@var v3 = vec3 * 2.0d
```

---

<a id="sem002"></a>
### SEM002: unknown-type (semantic error)

A type written in a `@define`, `@for`, or first-line parameter declaration must resolve to a known class. Typos and missing `@using` lines are the usual cause.

```msc
# bad
@define Wdiget w
@for Mystery x in items
@done
#(Foo bar)

# good
@define Widget w
```

---

<a id="sem003"></a>
### SEM003: unknown-member (semantic error)

A `.member` access only fires this rule when the host's type is a known class — that way a broken receiver (`mystery.field`, `bogusFn().sub`) is reported once at the upstream cause rather than chained downstream.

```msc
# bad
@var name = widget.namee     # Widget has no `namee`

# good
@var name = widget.name
```

---

<a id="sem004"></a>
### SEM004: undefined-identifier (semantic error)

A bare identifier in an expression position must resolve to a local binding, namespace member, or class. Member access (`x.y`) and namespace-qualified names (`tools::y`) are handled by their own rules, and identifiers inside operator-syntax positions like `@cooldown 5s` or `@for Int x in xs` are not flagged.

```msc
# bad
@if mystery
@fi
@var count = bogusFn()
@command /say {{undeclaredVariable}}

# good
@define Int count = 0
@if count > 0
@fi
```

---

<a id="sem005"></a>
### SEM005: unknown-namespace (semantic error)

A namespace referenced in `@using` or in a `Name::member` qualifier must be either the default namespace or a `.nms` file the workspace has loaded.

```msc
# bad
@using nottools
@return nottools::makeWidget()

# good
@using tools
@return tools::makeWidget()
```

---

<a id="sem006"></a>
### SEM006: unknown-namespace-member (semantic error)

A `namespace::member` reference must point at a real member of that namespace. The namespace must be known (otherwise SEM005 fires instead).

```msc
# bad
@return math::sqaure(3)

# good
@return math::square(3)
```

---

<a id="sem007"></a>
### SEM007: non-boolean-condition (semantic error)

The condition expression after `@if` and `@elseif` must produce a `Boolean`. Truthy/falsy coercion is not supported.

```msc
# bad
@if count
	@return 1
@fi

# good
@if count > 0
	@return 1
@fi
```

---

<a id="sem008"></a>
### SEM008: non-array-iterable (semantic error)

The expression after `in` in a `@for` loop must have an array type.

```msc
# bad
@for Int x in count
	@return x
@done

# good
@for Int x in onlinePlayerCounts
	@return x
@done
```

---

<a id="sem009"></a>
### SEM009: for-element-type-mismatch (semantic error)

The variable type declared after `@for` must match the array's element type. The declared type is verbatim — no implicit numeric widening.

```msc
# bad
@for String name in onlinePlayerCounts    # array of Int, not String
	@return name
@done

# good
@for Int count in onlinePlayerCounts
	@return count
@done
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

Permission-changing commands are blocked in scripts whether invoked via `@bypass`, `@console`, or `@command`. This covers the vanilla `/op` and `/deop`, the rank command `/rank`, and the LuckPerms aliases (`/lp`, `/luckperms`, `/permissions`, `/perm`, `/perms`).

```msc
# bad
@bypass /op someone
@console /lp user someone permission set group.admin true
```

The quick fix deletes the offending line. Granting permissions from a script is by design impossible. You should issue these commands manually as an admin if you need them.

---

<a id="sec003"></a>
### SEC003: chat-commands-banned (security error)

Scripts cannot run player-executed chat commands via `@command` or `@bypass`. This covers `/chat`, `/gchat`, `/echat`, `/achat`, `/schat`, `/bchat`, `/pchat`, `/tchat`, `/alert`, `/p`, and `/t`.

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

---

<a id="sty001"></a>
### STY001: lowercase-variable-name (style error)

Variable names must start with a lowercase letter and contain only letters, digits, or underscores. Reserved names like `true`, `false`, `this`, and `null` are also invalid.

```msc
# bad
@define String Name = "Minr"

# good
@define String name = "Minr"
```

---

<a id="sty002"></a>
### STY002: unreachable-after-return (style warning)

Code after `@return` in the same block is unreachable.

```msc
# bad
@return
@command /say never runs
```

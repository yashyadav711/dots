function mdthemes --description 'Preview a markdown file (or a built-in sample) in every mdcat theme'
    set -l src
    set -l tmp
    if test -n "$argv[1]" -a -f "$argv[1]"
        set src $argv[1]
    else
        set tmp (mktemp --suffix=.md)
        set src $tmp
        printf '# Heading 1\n## Heading 2\n### Heading 3\n\nBody text with **bold**, *italic*, `inline code`, and a [link](https://nhq.dev).\n\n> A blockquote line.\n\n- bullet one\n- bullet two\n\n```python\ndef greet(name):\n    print(f"hello {name}")\n```\n\n| Col A | Col B |\n|-------|-------|\n| one   | two   |\n' >$src
    end
    for t in dark light catppuccin-mocha catppuccin-latte gruvbox-dark gruvbox-light dracula nord solarized-dark solarized-light
        set_color -o brwhite
        printf '\n════════════════  %s  ════════════════\n\n' $t
        set_color normal
        mdcat --theme $t $src
    end
    test -n "$tmp"; and rm -f $tmp
end

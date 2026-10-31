package dev.emc2.android;

/** Bounded, single-pass text projection. Never builds Android formatting spans. */
final class MailText {
    static String plain(String html) {
        if (html.length() > MailData.MAX_TEXT) throw new IllegalArgumentException("Message text exceeds safe limits.");
        StringBuilder text = new StringBuilder();
        int tags = 0;
        for (int at = 0; at < html.length();) {
            char c = html.charAt(at++);
            if (c == '<') {
                int end = html.indexOf('>', at);
                if (end < 0) { text.append('<').append(html.substring(at)); break; }
                if (++tags > 4000) throw new IllegalArgumentException("Message formatting exceeds safe limits.");
                text.append(' '); at = end + 1;
            } else if (c == '&') {
                // Entities have a small maximum spelling; malformed ampersands
                // do not trigger a repeated search through the remaining body.
                int end = at;
                while (end < html.length() && end - at < 12 && html.charAt(end) != ';' && html.charAt(end) != '&') end++;
                if (end < html.length() && html.charAt(end) == ';') {
                    String name = html.substring(at, end);
                    String decoded = entity(name);
                    if (decoded != null) { text.append(decoded); at = end + 1; continue; }
                }
                text.append('&');
            } else text.append(c);
        }
        return text.toString();
    }
    private static String entity(String name) {
        switch (name) {
            case "amp": return "&";
            case "lt": return "<";
            case "gt": return ">";
            case "quot": return "\"";
            case "apos": return "'";
            case "nbsp": return " ";
            default:
                try {
                    int code = name.startsWith("#x") || name.startsWith("#X") ? Integer.parseInt(name.substring(2), 16)
                            : name.startsWith("#") ? Integer.parseInt(name.substring(1)) : -1;
                    return code > 0 && Character.isValidCodePoint(code) && !(code >= 0xd800 && code <= 0xdfff)
                            ? new String(Character.toChars(code)) : null;
                } catch (NumberFormatException error) { return null; }
        }
    }
}

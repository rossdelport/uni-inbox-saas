import { forwardRef, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useContacts } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { Input } from "./Field";

type ContactAutocompleteProps = Omit<
  ComponentProps<typeof TextInput>,
  "value" | "onChangeText" | "onFocus" | "onBlur"
> & {
  value: string;
  onChangeText: (value: string) => void;
  accountId?: string | null;
  onFocus?: ComponentProps<typeof TextInput>["onFocus"];
  onBlur?: ComponentProps<typeof TextInput>["onBlur"];
};

function currentToken(value: string): string {
  const match = /(?:^|[,;\s])([^\s,;]*)$/.exec(value);
  return match?.[1] ?? "";
}

function currentTokenStart(value: string): number {
  return value.length - currentToken(value).length;
}

/** Recipient field shared by the iOS compose flow. The API stores a normal
 * comma-separated string, so this stays compatible with existing sending. */
export const ContactAutocompleteInput = forwardRef<TextInput, ContactAutocompleteProps>(
  function ContactAutocompleteInput({ value, onChangeText, accountId = null, onFocus, onBlur, ...inputProps }, ref) {
    const t = useTheme();
    const [focused, setFocused] = useState(false);
    const [lookup, setLookup] = useState("");
    const token = useMemo(() => currentToken(value), [value]);

    useEffect(() => {
      const timer = setTimeout(() => setLookup(token), 140);
      return () => clearTimeout(timer);
    }, [token]);

    const { data } = useContacts(lookup, accountId);
    const suggestions = focused ? data?.contacts ?? [] : [];

    function choose(email: string) {
      const start = currentTokenStart(value);
      onChangeText(`${value.slice(0, start)}${email}, ${value.slice(value.length)}`);
      setFocused(false);
    }

    return (
      <View>
        <Input
          {...inputProps}
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setTimeout(() => setFocused(false), 140);
            onBlur?.(event);
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {suggestions.length > 0 ? (
          <View style={[styles.menu, { backgroundColor: t.card, borderColor: t.line }]}>
            {suggestions.map((contact) => (
              <Pressable
                key={contact.email}
                onPress={() => choose(contact.email)}
                style={({ pressed }) => [styles.item, { backgroundColor: pressed ? t.chipBg : "transparent" }]}
              >
                <View style={styles.itemText}>
                  <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
                    {contact.display_name || contact.email}
                  </Text>
                  {contact.display_name ? (
                    <Text style={[styles.email, { color: t.faint }]} numberOfLines={1}>
                      {contact.email}
                    </Text>
                  ) : null}
                </View>
                {contact.frequency > 1 ? (
                  <Text style={[styles.count, { color: t.faint }]}>{contact.frequency} emails</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  },
);

ContactAutocompleteInput.displayName = "ContactAutocompleteInput";

const styles = StyleSheet.create({
  menu: {
    marginTop: 5,
    borderWidth: 1,
    borderRadius: 13,
    padding: 4,
    shadowColor: "#0A2540",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  item: {
    minHeight: 48,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  itemText: { flex: 1, gap: 2 },
  name: { fontSize: 13, fontWeight: "700" },
  email: { fontSize: 12 },
  count: { fontSize: 11, flexShrink: 0 },
});

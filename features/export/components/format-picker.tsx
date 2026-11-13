import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';

export type ExportFormat = 'pdf' | 'xlsx';

const DEFAULT_COPY: Record<ExportFormat, { icon: IoniconsName; title: string; body: string }> = {
    pdf: { icon: 'document-text-outline', title: 'PDF report', body: 'A formatted summary with charts, ready to read or print.' },
    xlsx: { icon: 'grid-outline', title: 'Excel workbook', body: 'Every transaction as rows you can sort, filter and sum.' },
};

interface FormatPickerProps {
    value: ExportFormat;
    onChange: (format: ExportFormat) => void;
    /** Override the one-line description under each format. */
    descriptions?: Partial<Record<ExportFormat, string>>;
}

/** PDF / Excel radio cards used by the export sheets. */
export function FormatPicker({ value, onChange, descriptions }: FormatPickerProps) {
    const colors = useThemeColors();
    return (
        <View className="gap-2 mb-6" accessibilityRole="radiogroup">
            {(Object.keys(DEFAULT_COPY) as ExportFormat[]).map(key => {
                const f = DEFAULT_COPY[key];
                const body = descriptions?.[key] ?? f.body;
                const selected = key === value;
                return (
                    <Pressable
                        key={key}
                        onPress={() => onChange(key)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${f.title}. ${body}`}
                        className="flex-row items-center rounded-xl px-4 py-3.5"
                        style={({ pressed }) => ({
                            borderWidth: selected ? 1.5 : 1,
                            borderColor: selected ? colors.textPrimary : colors.borderStrong,
                            backgroundColor: selected ? colors.surface : pressed ? colors.backgroundAlt : 'transparent',
                        })}
                    >
                        <Ionicons name={f.icon} size={22} color={selected ? colors.primary : colors.textSecondary} />
                        <View className="flex-1 mx-3">
                            <ThemedText type="defaultSemiBold" className="text-[15px]">{f.title}</ThemedText>
                            <ThemedText type="caption">{body}</ThemedText>
                        </View>
                        <Ionicons
                            name={selected ? 'radio-button-on' : 'radio-button-off'}
                            size={20}
                            color={selected ? colors.textPrimary : colors.borderStrong}
                        />
                    </Pressable>
                );
            })}
        </View>
    );
}

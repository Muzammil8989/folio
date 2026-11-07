import { AppCard, ThemedText } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { HouseholdConfig } from '@/lib/db/queries';
import { HouseholdPeriodRange } from '@/features/household/hooks/use-household';
import { UserService } from '@/features/user/services/user-service';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';

/** Each period has its own income: past ones keep theirs in History. */
const PERIOD_LABELS: Record<string, string> = {
    monthly: "This month's",
    weekly: "This week's",
    yearly: "This year's",
};

interface IncomeCardProps {
    config: HouseholdConfig;
    periodRange: HouseholdPeriodRange;
    currencyCode: string;
    onEdit: () => void;
}

export function IncomeCard({ config, periodRange, currencyCode, onEdit }: IncomeCardProps) {
    const colors = useThemeColors();

    return (
        <AppCard className="p-5 mb-4" circleSize={100} circleOffset={28}>

            {/* Header row */}
            <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center gap-2">
                    <Ionicons name="home-outline" size={14} color={colors.textMuted} />
                    <ThemedText type="kicker">
                        {PERIOD_LABELS[config.period]} household income
                    </ThemedText>
                </View>
                <Pressable
                    onPress={onEdit}
                    className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl"
                    style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                    hitSlop={8}
                >
                    <Ionicons name="pencil-outline" size={13} color={colors.primary} />
                    <ThemedText className="text-[11px] font-semibold" style={{ color: colors.primary }}>
                        Edit
                    </ThemedText>
                </Pressable>
            </View>

            {/* Amount */}
            <ThemedText
                className="text-4xl font-semibold leading-tight text-textPrimary dark:text-dark-textPrimary mt-2 mb-1"
                style={{ fontFamily: 'SpaceGrotesk_700Bold' }}
                numberOfLines={1}
                adjustsFontSizeToFit
            >
                {UserService.formatCurrency(config.income_amount, currencyCode)}
            </ThemedText>

            {/* Period range label */}
            <View className="flex-row items-center gap-1.5">
                <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                <ThemedText className="text-xs font-medium text-textMuted dark:text-dark-textMuted">
                    {periodRange.label}
                </ThemedText>
            </View>
        </AppCard>
    );
}

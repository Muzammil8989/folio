import { AppButton, AppModal, ThemedText } from '@/components/common';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface DeleteConfirmSheetProps {
  visible: boolean;
  loanPersonName: string;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}

export function DeleteConfirmSheet({ visible, loanPersonName, onConfirm, onClose, loading }: DeleteConfirmSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <AppModal visible animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Animated.View
          entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
          style={{
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: 'center',
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: insets.bottom + 32,
            overflow: 'hidden',
            borderTopWidth: 1,
            borderColor: colors.divider,
          }}
        >
          <View className="w-9 h-1 rounded-full mx-auto mb-5" style={{ backgroundColor: colors.borderStrong }} />

          <View
            className="w-16 h-16 rounded-full items-center justify-center mx-auto mb-5 border border-divider dark:border-dark-divider"
          >
            <Ionicons name="trash-outline" size={28} color={colors.expense} />
          </View>

          <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
            Delete Loan?
          </ThemedText>
          <ThemedText className="text-sm text-center mb-8 text-textMuted dark:text-dark-textMuted">
            {'Loan record for "'}{loanPersonName}{'" will be removed. Related transactions stay in your history.'}
          </ThemedText>

          <View className="gap-3">
            <AppButton label="Delete" onPress={onConfirm} variant="destructive" loading={loading} disabled={loading} />
            <AppButton label="Cancel" onPress={onClose} variant="secondary" disabled={loading} />
          </View>
        </Animated.View>
      </View>
    </AppModal>
  );
}

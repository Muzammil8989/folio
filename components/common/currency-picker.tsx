import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { borderRadius } from '@/theme/border-radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Keyboard, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { Pressable } from './pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { FlagIcon } from './flag-icon';
import { ThemedText } from './themed-text';
import { AppModal } from './app-modal';

interface CurrencyPickerProps {
  value: string;
  onSelect: (code: string) => void;
  /** 'card' = standalone field (onboarding); 'row' = a row inside a settings group. */
  variant?: 'card' | 'row';
}

const POPULAR_LIST = ['USD', 'EUR', 'GBP', 'PKR', 'INR', 'JPY', 'CNY', 'CAD', 'AUD', 'AED'];

// M3 state layer: scale feedback for primary interactive element
const PRESSED_SCALE = 0.97;

export function CurrencyPicker({ value, onSelect, variant = 'card' }: CurrencyPickerProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [isVisible, setIsVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'popular' | 'all'>('popular');
  const [searchFocused, setSearchFocused] = useState(false);

  // M3 state layer for trigger button
  const triggerScale = useSharedValue(1);
  const triggerAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: triggerScale.value }] }));

  // Sheet animation — offsets come from the real window height (rotation / tall phones / tablets)
  const { height: windowHeight } = useWindowDimensions();
  const topInset = insets.top;
  const sheetY = useSharedValue(windowHeight);
  const backdropOpacity = useSharedValue(0);
  // Lift the sheet above the keyboard while the search field is focused, and shrink it
  // so the header + search field never get pushed above the top of the screen.
  // Keyboard height from react-native-keyboard-controller (see BottomSheet).
  const keyboard = useReanimatedKeyboardAnimation();
  const sheetStyle = useAnimatedStyle(() => {
    const keyboardLift = -keyboard.height.value;
    return {
      transform: [{ translateY: sheetY.value - keyboardLift }],
      maxHeight: Math.min(windowHeight * 0.88, windowHeight - keyboardLift - topInset),
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  const selectedCurrency = POPULAR_CURRENCIES.find((c) => c.code === value) || POPULAR_CURRENCIES[0];

  const filteredCurrencies = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const currencies = activeTab === 'popular'
      ? POPULAR_CURRENCIES.filter((c) => POPULAR_LIST.includes(c.code))
      : POPULAR_CURRENCIES;
    if (!query) return currencies;
    return currencies.filter(
      (c) => c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query),
    );
  }, [searchQuery, activeTab]);

  const handleTabChange = (tab: 'popular' | 'all') => {
    setActiveTab(tab);
    setSearchQuery('');
  };

  const openModal = () => {
    setIsVisible(true);
    sheetY.value = windowHeight;
    backdropOpacity.value = 0;
    sheetY.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
    backdropOpacity.value = withTiming(1, { duration: 300 });
  };

  const dismissModal = () => {
    setIsVisible(false);
    setSearchQuery('');
    setActiveTab('popular');
  };

  const closeModal = () => {
    Keyboard.dismiss();
    sheetY.value = withTiming(windowHeight, { duration: 280, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(dismissModal)();
    });
    backdropOpacity.value = withTiming(0, { duration: 260 });
  };

  return (
    <View className="w-full">
      {/* Trigger button */}
      <Animated.View style={triggerAnimStyle}>
        <Pressable
          onPress={openModal}
          onPressIn={() => { triggerScale.value = withTiming(PRESSED_SCALE, { duration: 80 }); }}
          onPressOut={() => { triggerScale.value = withTiming(1, { duration: 150 }); }}
          accessibilityRole="button"
          accessibilityLabel={`Selected currency: ${selectedCurrency.code}, ${selectedCurrency.name}`}
          className={variant === 'row'
            ? 'w-full px-4 min-h-[60px] py-3 flex-row items-center'
            : 'w-full rounded-xl px-4 py-3.5 flex-row items-center border border-borderStrong dark:border-dark-borderStrong bg-surface dark:bg-dark-surface'}
        >
          {variant === 'row' ? (
            <>
              <View className="w-7 mr-3 items-center">
                <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
              </View>
              <View className="flex-1 mr-3">
                <ThemedText type="defaultSemiBold" className="text-[15px] leading-5">Currency</ThemedText>
                <ThemedText type="caption" className="mt-0.5" numberOfLines={1}>{selectedCurrency.name}</ThemedText>
              </View>
              <FlagIcon code={selectedCurrency.flag} size={20} />
              <ThemedText type="label" className="ml-2 mr-1" style={{ color: colors.textSecondary }}>
                {selectedCurrency.code}
              </ThemedText>
              <Ionicons name="chevron-forward" color={colors.textMuted} size={18} />
            </>
          ) : (
            <>
              <FlagIcon code={selectedCurrency.flag} size={28} />
              <View className="flex-1 ml-3">
                <ThemedText type="defaultSemiBold" className="leading-tight">
                  {selectedCurrency.code} — {selectedCurrency.symbol}
                </ThemedText>
                <ThemedText type="caption">{selectedCurrency.name}</ThemedText>
              </View>
              <Ionicons name="chevron-expand-outline" color={colors.textMuted} size={20} />
            </>
          )}
        </Pressable>
      </Animated.View>

      <AppModal visible={isVisible} animationType="none" transparent onRequestClose={closeModal}>
        <Animated.View style={[{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }, backdropStyle]}>
          <Pressable style={{ flex: 1 }} onPress={closeModal} />
          <Animated.View
            style={[sheetStyle, {
              // Same reading column as the app on tablets / landscape.
              width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center',
              ...shadows.lg, shadowColor: colors.black, shadowOffset: { width: 0, height: -4 }, elevation: 16, paddingBottom: insets.bottom + 24,
            }]}
            className="bg-surface dark:bg-dark-surface rounded-t-3xl px-6 pt-4 overflow-hidden"
          >

            {/* Drag handle — M3 spec: 32dp wide, 4dp tall */}
            <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />

            {/* Header */}
            <View className="flex-row justify-between items-center mb-6">
              <View className="flex-row items-center gap-3">
                <ThemedText type="headline">Choose currency</ThemedText>
              </View>
              <Pressable
                onPress={closeModal}
                accessibilityRole="button"
                accessibilityLabel="Close currency picker"
                style={({ pressed }) => [{
                  width: 40, height: 40, borderRadius: 20,
                  alignItems: 'center', justifyContent: 'center',
                }, pressed && { backgroundColor: colors.backgroundAlt }]}
              >
                <Ionicons name="close" color={colors.textSecondary} size={22} />
              </Pressable>
            </View>

            {/* Search Bar */}
            <View className="mb-5 relative">
              {/* M3: icon adopts primary on focus; top aligned to paddingVertical */}
              <View style={{ position: 'absolute', left: spacing.md, top: spacing.md, zIndex: 10 }}>
                <Ionicons
                  name="search-outline"
                  color={searchFocused ? colors.primary : colors.textMuted}
                  size={18}
                />
              </View>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search by name or code..."
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Search currencies"
                style={{
                  backgroundColor: colors.inputBg,
                  color: colors.inputText,
                  borderWidth: 1,
                  borderColor: searchFocused ? colors.inputBorderFocused : colors.inputBorder,
                  borderRadius: borderRadius.xl,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.md,
                  paddingLeft: 46,
                  fontSize: typography.fontSizes.sm,
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                }}
              />
            </View>

            {/* Tabs — M3 Segmented Button pattern */}
            <View
              className="flex-row p-1 rounded-xl mb-5"
              style={{ backgroundColor: colors.backgroundAlt }}
            >
              {(['popular', 'all'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => handleTabChange(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeTab === tab }}
                  className="flex-1 py-3 rounded-xl flex-row items-center justify-center gap-1.5"
                  style={({ pressed }) => [
                    activeTab === tab
                      // shadows.sm token; colors.black replaces hardcoded '#000'
                      ? { backgroundColor: colors.surface, ...shadows.sm, shadowColor: colors.black }
                      : undefined,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons
                    name={tab === 'popular' ? 'star-outline' : 'globe-outline'}
                    size={14}
                    color={activeTab === tab ? colors.primary : colors.textMuted}
                  />
                  {/* ThemedText replaces raw Text; font-bold = fontWeights.bold (was font-black) */}
                  <ThemedText
                    className="font-bold text-sm"
                    style={{ color: activeTab === tab ? colors.primary : colors.textMuted }}
                  >
                    {tab === 'popular' ? 'Popular' : 'All Countries'}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {/* Results count */}
            <Animated.View
              key={activeTab}
              entering={FadeIn.duration(400).easing(Easing.bezier(0.25, 0.1, 0.25, 1))}
              exiting={FadeOut.duration(200)}
              className="mb-3"
            >
              {/* text-xs = typography.fontSizes.xs (12px); font-semibold within token scale */}
              <ThemedText
                type="kicker"
                style={{ color: colors.textMuted }}
              >
                {filteredCurrencies.length} {activeTab === 'popular' ? 'popular' : ''} currencies
              </ThemedText>
            </Animated.View>

            {/* Currency List */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {filteredCurrencies.length === 0 ? (
                <View className="py-20 items-center gap-3">
                  <View style={{
                    backgroundColor: colors.backgroundAlt,
                    width: 64, height: 64,
                    borderRadius: borderRadius['2xl'],   // 24px token (was 20, magic)
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="search-outline" color={colors.textMuted} size={28} />
                  </View>
                  <ThemedText className="text-sm font-bold" style={{ color: colors.textMuted }}>
                    No currencies found
                  </ThemedText>
                </View>
              ) : (
                filteredCurrencies.map((item) => {
                  const isSelected = item.code === value;
                  // No per-row layout animations: with ~150 rows they stall every keystroke.
                  return (
                    <Pressable
                      key={item.code}
                      onPress={() => { onSelect(item.code); closeModal(); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${item.name}, ${item.code}, ${item.symbol}`}
                      className="flex-row items-center justify-between p-3.5 rounded-xl mb-2"
                      style={({ pressed }) => [
                        isSelected
                          // borderWidth 1 replaces 1.5 (non-integer)
                          ? { backgroundColor: `${colors.primary}12`, borderWidth: 1, borderColor: `${colors.primary}30` }
                          : { backgroundColor: colors.backgroundAlt },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View className="flex-row items-center gap-3">
                        <FlagIcon code={item.flag} size={22} />

                        <View>
                          <View className="flex-row items-center gap-2">
                            {/* font-bold = fontWeights.bold (was font-black, outside token) */}
                            <ThemedText className="text-sm font-bold">{item.code}</ThemedText>
                            <View style={{
                              backgroundColor: `${colors.primary}15`,
                              borderRadius: borderRadius.md,   // 8px token (was 6, magic)
                              paddingHorizontal: spacing.xs,   // 4px token (was 6, magic)
                              paddingVertical: 2,
                            }}>
                              {/* text-xs = typography.fontSizes.xs; font-semibold within token scale */}
                              <ThemedText
                                className="text-xs font-semibold"
                                style={{ color: colors.primary }}
                              >
                                {item.symbol}
                              </ThemedText>
                            </View>
                          </View>
                          <ThemedText className="text-xs" style={{ color: colors.textMuted }}>
                            {item.name}
                          </ThemedText>
                        </View>
                      </View>

                      {isSelected && (
                        <View style={{
                          backgroundColor: `${colors.primary}20`,
                          borderRadius: borderRadius.lg,   // 12px token (was 10, magic)
                          padding: spacing.xs,             // 4px token ✅
                        }}>
                          <Ionicons name="checkmark" color={colors.primary} size={16} />
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </AppModal>
    </View>
  );
}

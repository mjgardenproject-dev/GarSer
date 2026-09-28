// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return { channel, channelFn: vi.fn(() => channel), removeChannel: vi.fn() };
});

vi.mock('../lib/supabase', () => ({ supabase: { channel: mocks.channelFn, removeChannel: mocks.removeChannel } }));
vi.mock('../utils/chatService', () => ({ fetchChatOverview: vi.fn(async () => ({ a: { unread_count: 2 } })) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/AccountContext', () => ({ useAccount: () => ({ role: null, loading: false }) }));

import { subscribeUnreadChats } from './useUnreadChats';

describe('contador de chats compartido (R-01b)', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.channelFn.mockClear(); mocks.removeChannel.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('dos barras montadas a la vez abren UN canal', () => {
    const a = subscribeUnreadChats('u1', () => undefined);
    const b = subscribeUnreadChats('u1', () => undefined);
    expect(mocks.channelFn).toHaveBeenCalledTimes(1);
    a(); b();
    vi.advanceTimersByTime(2500);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('soltar una barra no cierra el canal de la otra', () => {
    const a = subscribeUnreadChats('u2', () => undefined);
    const b = subscribeUnreadChats('u2', () => undefined);
    a();
    vi.advanceTimersByTime(5000);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
    b();
    vi.advanceTimersByTime(2500);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('un cambio de página rápido no abre y cierra el canal', () => {
    const a = subscribeUnreadChats('u3', () => undefined);
    a();
    vi.advanceTimersByTime(500);
    const b = subscribeUnreadChats('u3', () => undefined);
    vi.advanceTimersByTime(5000);
    expect(mocks.channelFn).toHaveBeenCalledTimes(1);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
    b();
    vi.advanceTimersByTime(2500);
  });
});

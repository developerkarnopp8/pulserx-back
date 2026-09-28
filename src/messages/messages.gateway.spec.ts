import { MessagesGateway } from './messages.gateway';
import { JwtService } from '@nestjs/jwt';

function buildClient(overrides: Partial<any> = {}) {
  return {
    id: 'socket-1',
    handshake: { auth: {}, headers: {} },
    data: {},
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    ...overrides,
  } as any;
}

function build() {
  const jwt = { verify: jest.fn() };
  const gateway = new MessagesGateway(jwt as unknown as JwtService);
  const to = jest.fn();
  const emit = jest.fn();
  to.mockReturnValue({ emit });
  gateway.server = { to } as any;
  return { gateway, jwt, to, emit };
}

describe('MessagesGateway.handleConnection', () => {
  it('token no handshake.auth: valida e coloca o socket na sala do usuário', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    const client = buildClient({ handshake: { auth: { token: 'tok-1' }, headers: {} } });

    gateway.handleConnection(client);

    expect(jwt.verify).toHaveBeenCalledWith('tok-1');
    expect(client.data.userId).toBe('user-1');
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('sem auth.token, usa o header Authorization (Bearer)', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-2' });
    const client = buildClient({ handshake: { auth: {}, headers: { authorization: 'Bearer tok-2' } } });

    gateway.handleConnection(client);

    expect(jwt.verify).toHaveBeenCalledWith('tok-2');
    expect(client.join).toHaveBeenCalledWith('user:user-2');
  });

  it('token inválido: desconecta o socket e não entra em sala nenhuma', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockImplementation(() => { throw new Error('invalid'); });
    const client = buildClient();

    expect(() => gateway.handleConnection(client)).not.toThrow();
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('várias abas do mesmo usuário entram na MESMA sala (nenhuma substitui a outra)', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    const tab1 = buildClient({ id: 's1', handshake: { auth: { token: 'x' }, headers: {} } });
    const tab2 = buildClient({ id: 's2', handshake: { auth: { token: 'x' }, headers: {} } });

    gateway.handleConnection(tab1);
    gateway.handleConnection(tab2);

    expect(tab1.join).toHaveBeenCalledWith('user:user-1');
    expect(tab2.join).toHaveBeenCalledWith('user:user-1');
  });
});

describe('MessagesGateway.emitToUser', () => {
  it('emite new_message só pra sala do destinatário', () => {
    const { gateway, to, emit } = build();

    gateway.emitToUser('user-1', { text: 'oi' });

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('new_message', { text: 'oi' });
  });
});

describe('MessagesGateway.emitNotification', () => {
  it('emite new_notification só pra sala do destinatário', () => {
    const { gateway, to, emit } = build();

    gateway.emitNotification('user-1', { title: 'Novo recorde!' });

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('new_notification', { title: 'Novo recorde!' });
  });
});

describe('MessagesGateway.handlePing', () => {
  it('responde pong pro próprio client', () => {
    const { gateway } = build();
    const client = buildClient();
    gateway.handlePing(client);
    expect(client.emit).toHaveBeenCalledWith('pong');
  });
});

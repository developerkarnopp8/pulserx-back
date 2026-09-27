import { MessagesGateway } from './messages.gateway';
import { JwtService } from '@nestjs/jwt';

function buildClient(overrides: Partial<any> = {}) {
  return {
    id: 'socket-1',
    handshake: { auth: {}, headers: {} },
    data: {},
    disconnect: jest.fn(),
    emit: jest.fn(),
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
  it('token no handshake.auth: valida e guarda o socket do usuário', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    const client = buildClient({ handshake: { auth: { token: 'tok-1' }, headers: {} } });

    gateway.handleConnection(client);

    expect(jwt.verify).toHaveBeenCalledWith('tok-1');
    expect(client.data.userId).toBe('user-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('sem auth.token, usa o header Authorization (Bearer)', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-2' });
    const client = buildClient({ handshake: { auth: {}, headers: { authorization: 'Bearer tok-2' } } });

    gateway.handleConnection(client);

    expect(jwt.verify).toHaveBeenCalledWith('tok-2');
    expect(client.data.userId).toBe('user-2');
  });

  it('token inválido: desconecta o socket, sem lançar', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockImplementation(() => { throw new Error('invalid'); });
    const client = buildClient();

    expect(() => gateway.handleConnection(client)).not.toThrow();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('MessagesGateway.handleDisconnect', () => {
  it('remove o socket do mapa quando o client tinha userId', () => {
    const { gateway, jwt } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    const client = buildClient({ handshake: { auth: { token: 'tok-1' }, headers: {} } });
    gateway.handleConnection(client);

    gateway.handleDisconnect(client);

    gateway.emitToUser('user-1', { text: 'oi' });
    const { to } = gateway.server as any;
    expect(to).not.toHaveBeenCalled();
  });

  it('client sem userId: não faz nada (sem erro)', () => {
    const { gateway } = build();
    const client = buildClient();
    expect(() => gateway.handleDisconnect(client)).not.toThrow();
  });
});

describe('MessagesGateway.emitToUser', () => {
  it('emite new_message pro socket do destinatário quando ele está conectado', () => {
    const { gateway, jwt, to, emit } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    gateway.handleConnection(buildClient({ id: 'socket-1', handshake: { auth: { token: 'x' }, headers: {} } }));

    gateway.emitToUser('user-1', { text: 'oi' });

    expect(to).toHaveBeenCalledWith('socket-1');
    expect(emit).toHaveBeenCalledWith('new_message', { text: 'oi' });
  });

  it('destinatário não conectado: não emite nada', () => {
    const { gateway, to } = build();
    gateway.emitToUser('user-sem-socket', { text: 'oi' });
    expect(to).not.toHaveBeenCalled();
  });
});

describe('MessagesGateway.emitNotification', () => {
  it('emite new_notification pro socket do destinatário quando ele está conectado', () => {
    const { gateway, jwt, to, emit } = build();
    jwt.verify.mockReturnValue({ sub: 'user-1' });
    gateway.handleConnection(buildClient({ id: 'socket-1', handshake: { auth: { token: 'x' }, headers: {} } }));

    gateway.emitNotification('user-1', { title: 'Novo recorde!' });

    expect(to).toHaveBeenCalledWith('socket-1');
    expect(emit).toHaveBeenCalledWith('new_notification', { title: 'Novo recorde!' });
  });

  it('destinatário não conectado: não emite nada', () => {
    const { gateway, to } = build();
    gateway.emitNotification('user-sem-socket', { title: 'x' });
    expect(to).not.toHaveBeenCalled();
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

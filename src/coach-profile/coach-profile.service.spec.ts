import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CoachProfileService, pickPageCopy } from './coach-profile.service';

function build() {
  const prisma: any = {
    coachProfile: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    subscriptionPlan: { findMany: jest.fn() },
    lead: { create: jest.fn() },
    testimonial: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    faqItem: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
  const cloudinary = { uploadImage: jest.fn() };
  const notifications = { create: jest.fn() };
  const email = { send: jest.fn() };
  const service = new CoachProfileService(prisma, cloudinary as any, notifications as any, email as any);
  return { service, prisma, cloudinary, notifications, email };
}

describe('CoachProfileService.getMine', () => {
  it('devolve o perfil do coach (ou null se não existir)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1', coachId: 'coach-1' });
    await expect(service.getMine('coach-1')).resolves.toEqual({ id: 'p1', coachId: 'coach-1' });
    expect(prisma.coachProfile.findUnique).toHaveBeenCalledWith({ where: { coachId: 'coach-1' } });
  });
});

describe('CoachProfileService.upsert', () => {
  const fullDto = {
    slug: 'luan', bio: 'Treinador', headline: 'Headline', subheadline: 'Sub', quote: 'Quote',
    achievementBadge: 'Semifinals', yearsExperience: 12, athletesCount: 1400, npsScore: 92,
    completionRate: 88.4, whatsappNumber: '11999999999', videoUrl: 'https://youtu.be/abc',
  };

  it('cria o perfil quando o slug está livre, com todos os campos', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1', coachId: 'coach-1', ...fullDto });

    await service.upsert('coach-1', fullDto as never);

    const { slug, ...rest } = fullDto;
    expect(prisma.coachProfile.upsert).toHaveBeenCalledWith({
      where: { coachId: 'coach-1' },
      create: { coachId: 'coach-1', slug, ...rest },
      update: { slug, ...rest },
    });
  });

  it('slug já usado pelo PRÓPRIO coach: deixa passar (é edição, não conflito)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1' });

    await expect(service.upsert('coach-1', { slug: 'luan' } as never)).resolves.toBeDefined();
  });

  it('slug já usado por OUTRO coach: 409, sem tentar upsert', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.upsert('coach-1', { slug: 'luan' } as never)).rejects.toThrow(ConflictException);
    expect(prisma.coachProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('CoachProfileService.upsert — garantia, suporte e textos da página', () => {
  it('grava garantia/suporte e só os campos conhecidos dos textos (máx. 4 cards)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1' });
    const pillars = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, text: `Texto ${i}`, extra: 'x' }));

    await service.upsert('coach-1', {
      slug: 'luan', guaranteeDays: 30, guaranteeText: 'Devolvo 100%', supportEmail: 'suporte@example.com',
      supportHours: 'Seg a sex', pageCopy: { howItWorksTitle: 'Como funciona', plansTitle: 'Planos', finalTitle: 'Bora', finalCtaLabel: 'Quero', pillars, lixo: 'x' },
    } as never);

    const data = prisma.coachProfile.upsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ guaranteeDays: 30, guaranteeText: 'Devolvo 100%', supportEmail: 'suporte@example.com', supportHours: 'Seg a sex' });
    expect(data.pageCopy).toEqual({
      howItWorksTitle: 'Como funciona', plansTitle: 'Planos', finalTitle: 'Bora', finalCtaLabel: 'Quero',
      pillars: pillars.slice(0, 4).map(({ title, text }) => ({ title, text })),
    });
  });

  it('sem textos da página: não mexe no que já estava salvo', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1' });
    await service.upsert('coach-1', { slug: 'luan' } as never);
    expect(prisma.coachProfile.upsert.mock.calls[0][0].update.pageCopy).toBeUndefined();
  });

  it('pickPageCopy ignora valores que não são texto e pillars que não é lista', () => {
    expect(pickPageCopy({ plansTitle: 123, pillars: 'x' } as never)).toEqual({});
  });
});

describe('CoachProfileService.setPublished', () => {
  it('sem perfil configurado: 400, não tenta atualizar', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.setPublished('coach-1', true)).rejects.toThrow(BadRequestException);
    expect(prisma.coachProfile.update).not.toHaveBeenCalled();
  });

  it('com perfil: liga/desliga published', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.coachProfile.update.mockResolvedValue({ id: 'p1', published: true });

    await expect(service.setPublished('coach-1', true)).resolves.toEqual({ id: 'p1', published: true });
    expect(prisma.coachProfile.update).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, data: { published: true } });
  });
});

describe('CoachProfileService.uploadBanner / uploadPhoto', () => {
  it('uploadBanner sem perfil configurado: 400, não sobe nada', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.uploadBanner('coach-1', Buffer.from('img'))).rejects.toThrow(BadRequestException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('uploadBanner com perfil: sobe na pasta certa e salva bannerUrl', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1' });
    cloudinary.uploadImage.mockResolvedValue({ url: 'https://x/banner.jpg' });
    prisma.coachProfile.update.mockResolvedValue({ id: 'p1', bannerUrl: 'https://x/banner.jpg' });

    const result = await service.uploadBanner('coach-1', Buffer.from('img'));

    expect(cloudinary.uploadImage).toHaveBeenCalledWith(Buffer.from('img'), 'pulserx/coach-banners/coach-1');
    expect(prisma.coachProfile.update).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, data: { bannerUrl: 'https://x/banner.jpg' } });
    expect(result.bannerUrl).toBe('https://x/banner.jpg');
  });

  it('uploadPhoto sem perfil configurado: 400, não sobe nada', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.uploadPhoto('coach-1', Buffer.from('img'))).rejects.toThrow(BadRequestException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('uploadPhoto com perfil: sobe na pasta certa e salva photoUrl', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1' });
    cloudinary.uploadImage.mockResolvedValue({ url: 'https://x/photo.jpg' });
    prisma.coachProfile.update.mockResolvedValue({ id: 'p1', photoUrl: 'https://x/photo.jpg' });

    const result = await service.uploadPhoto('coach-1', Buffer.from('img'));

    expect(cloudinary.uploadImage).toHaveBeenCalledWith(Buffer.from('img'), 'pulserx/coach-photos/coach-1');
    expect(prisma.coachProfile.update).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, data: { photoUrl: 'https://x/photo.jpg' } });
    expect(result.photoUrl).toBe('https://x/photo.jpg');
  });
});

describe('CoachProfileService — depoimentos', () => {
  it('listTestimonials devolve os depoimentos do coach, ordenados', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findMany.mockResolvedValue([{ id: 't1' }]);

    await expect(service.listTestimonials('coach-1')).resolves.toEqual([{ id: 't1' }]);
    expect(prisma.testimonial.findMany).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, orderBy: { order: 'asc' } });
  });

  it('createTestimonial usa rating/order padrão quando ausentes', async () => {
    const { service, prisma } = build();
    prisma.testimonial.create.mockResolvedValue({ id: 't1' });

    await service.createTestimonial('coach-1', { authorName: 'Ana', content: 'Ótimo!' } as never);

    expect(prisma.testimonial.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', authorName: 'Ana', authorRole: undefined, rating: undefined, content: 'Ótimo!', order: 0 },
    });
  });

  it('updateTestimonial: dono edita', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.testimonial.update.mockResolvedValue({ id: 't1', authorName: 'Ana 2' });

    await expect(service.updateTestimonial('t1', 'coach-1', { authorName: 'Ana 2', content: 'X' } as never))
      .resolves.toEqual({ id: 't1', authorName: 'Ana 2' });
  });

  it('updateTestimonial: inexistente → 404', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findUnique.mockResolvedValue(null);

    await expect(service.updateTestimonial('t1', 'coach-1', {} as never)).rejects.toThrow(NotFoundException);
    expect(prisma.testimonial.update).not.toHaveBeenCalled();
  });

  it('updateTestimonial: de outro coach → 403, sem atualizar (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.updateTestimonial('t1', 'coach-1', {} as never)).rejects.toThrow(ForbiddenException);
    expect(prisma.testimonial.update).not.toHaveBeenCalled();
  });

  it('removeTestimonial: dono remove', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.testimonial.delete.mockResolvedValue({ id: 't1' });

    await expect(service.removeTestimonial('t1', 'coach-1')).resolves.toEqual({ removed: true });
  });

  it('removeTestimonial: de outro coach → 403, sem apagar (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.testimonial.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.removeTestimonial('t1', 'coach-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.testimonial.delete).not.toHaveBeenCalled();
  });
});

describe('CoachProfileService — FAQ', () => {
  it('listFaqItems devolve as perguntas do coach, ordenadas', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findMany.mockResolvedValue([{ id: 'f1' }]);

    await expect(service.listFaqItems('coach-1')).resolves.toEqual([{ id: 'f1' }]);
    expect(prisma.faqItem.findMany).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, orderBy: { order: 'asc' } });
  });

  it('createFaqItem usa order padrão 0 quando ausente', async () => {
    const { service, prisma } = build();
    prisma.faqItem.create.mockResolvedValue({ id: 'f1' });

    await service.createFaqItem('coach-1', { question: 'Q?', answer: 'A.' } as never);

    expect(prisma.faqItem.create).toHaveBeenCalledWith({ data: { coachId: 'coach-1', question: 'Q?', answer: 'A.', order: 0 } });
  });

  it('updateFaqItem: dono edita', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.faqItem.update.mockResolvedValue({ id: 'f1' });

    await expect(service.updateFaqItem('f1', 'coach-1', { question: 'Q2', answer: 'A2' } as never)).resolves.toEqual({ id: 'f1' });
  });

  it('updateFaqItem: inexistente → 404', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findUnique.mockResolvedValue(null);

    await expect(service.updateFaqItem('f1', 'coach-1', {} as never)).rejects.toThrow(NotFoundException);
  });

  it('updateFaqItem: de outro coach → 403 (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.updateFaqItem('f1', 'coach-1', {} as never)).rejects.toThrow(ForbiddenException);
    expect(prisma.faqItem.update).not.toHaveBeenCalled();
  });

  it('removeFaqItem: dono remove', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.faqItem.delete.mockResolvedValue({ id: 'f1' });

    await expect(service.removeFaqItem('f1', 'coach-1')).resolves.toEqual({ removed: true });
  });

  it('removeFaqItem: de outro coach → 403, sem apagar (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.faqItem.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.removeFaqItem('f1', 'coach-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.faqItem.delete).not.toHaveBeenCalled();
  });
});

describe('CoachProfileService.getPublicBySlug', () => {
  it('slug inexistente: 404', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.getPublicBySlug('nao-existe')).rejects.toThrow(NotFoundException);
  });

  it('perfil existe mas não está publicado: 404 (não revela que existe)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ published: false, coach: { id: 'coach-1', name: 'Luan' } });

    await expect(service.getPublicBySlug('luan')).rejects.toThrow(NotFoundException);
  });

  it('publicado: devolve todos os campos + planos ativos + depoimentos + faq, sem campos sensíveis', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({
      bio: 'Treinador', bannerUrl: 'https://x/banner.jpg', photoUrl: 'https://x/photo.jpg',
      headline: 'H', subheadline: 'S', quote: 'Q', achievementBadge: 'Semifinals',
      yearsExperience: 12, athletesCount: 1400, npsScore: 92, completionRate: 88.4,
      whatsappNumber: '11999999999', videoUrl: 'https://youtu.be/abc', published: true,
      coach: { id: 'coach-1', name: 'Luan' },
    });
    prisma.subscriptionPlan.findMany.mockResolvedValue([
      { id: 'plan1', name: 'Core', description: null, priceCents: 9900, categories: ['CORE'], isFree: false },
    ]);
    prisma.testimonial.findMany.mockResolvedValue([
      { id: 't1', coachId: 'coach-1', authorName: 'Ana', authorRole: 'Atleta', rating: 5, content: 'Ótimo!', order: 0, createdAt: new Date() },
    ]);
    prisma.faqItem.findMany.mockResolvedValue([
      { id: 'f1', coachId: 'coach-1', question: 'Serve pra iniciante?', answer: 'Sim.', order: 0, createdAt: new Date() },
    ]);

    const result = await service.getPublicBySlug('luan');

    expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: 'coach-1', active: true } }));
    expect(prisma.testimonial.findMany).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, orderBy: { order: 'asc' } });
    expect(prisma.faqItem.findMany).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, orderBy: { order: 'asc' } });
    expect(result).toEqual({
      coachName: 'Luan', bio: 'Treinador', bannerUrl: 'https://x/banner.jpg', photoUrl: 'https://x/photo.jpg',
      headline: 'H', subheadline: 'S', quote: 'Q', achievementBadge: 'Semifinals',
      yearsExperience: 12, athletesCount: 1400, npsScore: 92, completionRate: 88.4,
      whatsappNumber: '11999999999', videoUrl: 'https://youtu.be/abc',
      plans: [{ id: 'plan1', name: 'Core', description: null, priceCents: 9900, categories: ['CORE'], isFree: false }],
      testimonials: [{ id: 't1', authorName: 'Ana', authorRole: 'Atleta', rating: 5, content: 'Ótimo!' }],
      faqItems: [{ id: 'f1', question: 'Serve pra iniciante?', answer: 'Sim.' }],
    });
  });
});

describe('CoachProfileService.createLead', () => {
  const publishedProfile = {
    published: true,
    coach: { id: 'coach-1', name: 'Luan', email: 'luan@aevonfit.com' },
  };

  it('slug inexistente: 404, sem criar lead', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.createLead('nao-existe', { name: 'Ana', email: 'ana@x.com' })).rejects.toThrow(NotFoundException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('não publicado: 404, sem criar lead', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ ...publishedProfile, published: false });

    await expect(service.createLead('luan', { name: 'Ana', email: 'ana@x.com' })).rejects.toThrow(NotFoundException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('cria o lead, notifica o coach in-app e por e-mail', async () => {
    const { service, prisma, notifications, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1', coachId: 'coach-1', name: 'Ana', email: 'ana@x.com' });

    const result = await service.createLead('luan', { name: 'Ana', email: 'ana@x.com', phone: '11999999999', message: 'Quero treinar' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', name: 'Ana', email: 'ana@x.com', phone: '11999999999', message: 'Quero treinar' },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      'coach-1', 'new_lead', 'Novo contato pela sua página!',
      expect.stringContaining('Ana'), '/coach/landing-page',
    );
    expect(email.send).toHaveBeenCalledWith(
      'luan@aevonfit.com',
      'Novo contato de Ana — PulseRx',
      expect.stringContaining('Quero treinar'),
      expect.stringContaining('Telefone: 11999999999'),
    );
    expect(email.send.mock.calls[0][2]).toContain('/coach/landing-page');
    expect(result.id).toBe('lead1');
  });

  it('escapa HTML do nome/mensagem antes de montar o e-mail (XSS)', async () => {
    const { service, prisma, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1' });

    await service.createLead('luan', {
      name: '<script>alert(1)</script>', email: 'ana@x.com', message: '<img src=x onerror=alert(1)>',
    });

    const html = email.send.mock.calls[0][2];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('sem phone/message: não quebra e não aparecem no e-mail', async () => {
    const { service, prisma, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1' });

    await service.createLead('luan', { name: 'Ana', email: 'ana@x.com' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', name: 'Ana', email: 'ana@x.com', phone: undefined, message: undefined },
    });
    const html = email.send.mock.calls[0][2];
    expect(html).not.toContain('Mensagem');
    expect(email.send.mock.calls[0][3]).not.toContain('Mensagem');
    expect(email.send.mock.calls[0][3]).not.toContain('Telefone');
  });

  it('assunto é texto puro: quebra de linha colada no nome vira espaço', async () => {
    const { service, prisma, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1' });
    await service.createLead('luan', { name: 'Ana\r\nBcc: x@evil.com', email: 'ana@x.com' });
    expect(email.send.mock.calls[0][1]).toBe('Novo contato de Ana Bcc: x@evil.com — PulseRx');
  });
});

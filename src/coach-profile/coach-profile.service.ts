import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/escape-html';
import { UpdateCoachProfileDto, CreateLeadDto, UpsertTestimonialDto, UpsertFaqItemDto } from './dto/coach-profile.dto';

const PUBLIC_PLAN_SELECT = {
  id: true, name: true, description: true, priceCents: true, categories: true, isFree: true,
} as const;

@Injectable()
export class CoachProfileService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
    private notifications: NotificationsService,
    private email: EmailService,
  ) {}

  async getMine(coachId: string) {
    return this.prisma.coachProfile.findUnique({ where: { coachId } });
  }

  async upsert(coachId: string, dto: UpdateCoachProfileDto) {
    const existing = await this.prisma.coachProfile.findUnique({
      where: { slug: dto.slug },
      select: { coachId: true },
    });
    if (existing && existing.coachId !== coachId) {
      throw new ConflictException('Esse endereço já está em uso por outro coach — escolha outro.');
    }

    const data = {
      slug: dto.slug,
      bio: dto.bio,
      headline: dto.headline,
      subheadline: dto.subheadline,
      quote: dto.quote,
      achievementBadge: dto.achievementBadge,
      yearsExperience: dto.yearsExperience,
      athletesCount: dto.athletesCount,
      npsScore: dto.npsScore,
      completionRate: dto.completionRate,
      whatsappNumber: dto.whatsappNumber,
      videoUrl: dto.videoUrl,
    };

    return this.prisma.coachProfile.upsert({
      where: { coachId },
      create: { coachId, ...data },
      update: data,
    });
  }

  async setPublished(coachId: string, published: boolean) {
    const profile = await this.prisma.coachProfile.findUnique({ where: { coachId } });
    if (!profile) {
      throw new BadRequestException('Configure o endereço (slug) da sua página antes de publicar.');
    }
    return this.prisma.coachProfile.update({ where: { coachId }, data: { published } });
  }

  async uploadBanner(coachId: string, buffer: Buffer) {
    const profile = await this.prisma.coachProfile.findUnique({ where: { coachId } });
    if (!profile) {
      throw new BadRequestException('Configure o endereço (slug) da sua página antes de enviar o banner.');
    }
    const { url } = await this.cloudinary.uploadImage(buffer, `pulserx/coach-banners/${coachId}`);
    return this.prisma.coachProfile.update({ where: { coachId }, data: { bannerUrl: url } });
  }

  async uploadPhoto(coachId: string, buffer: Buffer) {
    const profile = await this.prisma.coachProfile.findUnique({ where: { coachId } });
    if (!profile) {
      throw new BadRequestException('Configure o endereço (slug) da sua página antes de enviar a foto.');
    }
    const { url } = await this.cloudinary.uploadImage(buffer, `pulserx/coach-photos/${coachId}`);
    return this.prisma.coachProfile.update({ where: { coachId }, data: { photoUrl: url } });
  }

  // ── Depoimentos ──────────────────────────────────────────────────────────

  async listTestimonials(coachId: string) {
    return this.prisma.testimonial.findMany({ where: { coachId }, orderBy: { order: 'asc' } });
  }

  async createTestimonial(coachId: string, dto: UpsertTestimonialDto) {
    return this.prisma.testimonial.create({
      data: { coachId, authorName: dto.authorName, authorRole: dto.authorRole, rating: dto.rating, content: dto.content, order: dto.order ?? 0 },
    });
  }

  private async assertOwnsTestimonial(id: string, coachId: string) {
    const testimonial = await this.prisma.testimonial.findUnique({ where: { id }, select: { coachId: true } });
    if (!testimonial) throw new NotFoundException('Depoimento não encontrado');
    if (testimonial.coachId !== coachId) throw new ForbiddenException('Você não tem acesso a este depoimento.');
  }

  async updateTestimonial(id: string, coachId: string, dto: UpsertTestimonialDto) {
    await this.assertOwnsTestimonial(id, coachId);
    return this.prisma.testimonial.update({
      where: { id },
      data: { authorName: dto.authorName, authorRole: dto.authorRole, rating: dto.rating, content: dto.content, order: dto.order },
    });
  }

  async removeTestimonial(id: string, coachId: string): Promise<{ removed: boolean }> {
    await this.assertOwnsTestimonial(id, coachId);
    await this.prisma.testimonial.delete({ where: { id } });
    return { removed: true };
  }

  // ── FAQ ──────────────────────────────────────────────────────────────────

  async listFaqItems(coachId: string) {
    return this.prisma.faqItem.findMany({ where: { coachId }, orderBy: { order: 'asc' } });
  }

  async createFaqItem(coachId: string, dto: UpsertFaqItemDto) {
    return this.prisma.faqItem.create({
      data: { coachId, question: dto.question, answer: dto.answer, order: dto.order ?? 0 },
    });
  }

  private async assertOwnsFaqItem(id: string, coachId: string) {
    const item = await this.prisma.faqItem.findUnique({ where: { id }, select: { coachId: true } });
    if (!item) throw new NotFoundException('Pergunta não encontrada');
    if (item.coachId !== coachId) throw new ForbiddenException('Você não tem acesso a esta pergunta.');
  }

  async updateFaqItem(id: string, coachId: string, dto: UpsertFaqItemDto) {
    await this.assertOwnsFaqItem(id, coachId);
    return this.prisma.faqItem.update({
      where: { id },
      data: { question: dto.question, answer: dto.answer, order: dto.order },
    });
  }

  async removeFaqItem(id: string, coachId: string): Promise<{ removed: boolean }> {
    await this.assertOwnsFaqItem(id, coachId);
    await this.prisma.faqItem.delete({ where: { id } });
    return { removed: true };
  }

  // ── Página pública ───────────────────────────────────────────────────────

  /** Página pública — só existe se published=true (sem revelar que existe despublicada). */
  async getPublicBySlug(slug: string) {
    const profile = await this.prisma.coachProfile.findUnique({
      where: { slug },
      select: {
        bio: true, bannerUrl: true, photoUrl: true, headline: true, subheadline: true, quote: true,
        achievementBadge: true, yearsExperience: true, athletesCount: true, npsScore: true,
        completionRate: true, whatsappNumber: true, videoUrl: true, published: true,
        coach: { select: { id: true, name: true } },
      },
    });
    if (!profile || !profile.published) throw new NotFoundException('Página não encontrada');

    const [plans, testimonials, faqItems] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where: { coachId: profile.coach.id, active: true },
        select: PUBLIC_PLAN_SELECT,
        orderBy: { priceCents: 'asc' },
      }),
      this.prisma.testimonial.findMany({ where: { coachId: profile.coach.id }, orderBy: { order: 'asc' } }),
      this.prisma.faqItem.findMany({ where: { coachId: profile.coach.id }, orderBy: { order: 'asc' } }),
    ]);

    return {
      coachName: profile.coach.name,
      bio: profile.bio,
      bannerUrl: profile.bannerUrl,
      photoUrl: profile.photoUrl,
      headline: profile.headline,
      subheadline: profile.subheadline,
      quote: profile.quote,
      achievementBadge: profile.achievementBadge,
      yearsExperience: profile.yearsExperience,
      athletesCount: profile.athletesCount,
      npsScore: profile.npsScore,
      completionRate: profile.completionRate,
      whatsappNumber: profile.whatsappNumber,
      videoUrl: profile.videoUrl,
      plans,
      testimonials: testimonials.map(t => ({ id: t.id, authorName: t.authorName, authorRole: t.authorRole, rating: t.rating, content: t.content })),
      faqItems: faqItems.map(f => ({ id: f.id, question: f.question, answer: f.answer })),
    };
  }

  async createLead(slug: string, dto: CreateLeadDto) {
    const profile = await this.prisma.coachProfile.findUnique({
      where: { slug },
      select: { published: true, coach: { select: { id: true, name: true, email: true } } },
    });
    if (!profile || !profile.published) throw new NotFoundException('Página não encontrada');

    const lead = await this.prisma.lead.create({
      data: { coachId: profile.coach.id, name: dto.name, email: dto.email, phone: dto.phone, message: dto.message },
    });

    await this.notifications.create(
      profile.coach.id,
      'new_lead',
      'Novo contato pela sua página!',
      `${dto.name} (${dto.email}) mandou uma mensagem pela sua landing page.`,
      '/coach/landing-page',
    );

    const safeName = escapeHtml(dto.name);
    const safeEmail = escapeHtml(dto.email);
    const safePhone = dto.phone ? escapeHtml(dto.phone) : undefined;
    const safeMessage = dto.message ? escapeHtml(dto.message) : undefined;
    await this.email.send(
      profile.coach.email,
      `Novo contato de ${safeName} — PulseRx`,
      `<p><strong>${safeName}</strong> (${safeEmail}${safePhone ? `, ${safePhone}` : ''}) entrou em contato pela sua página pública.</p>` +
      (safeMessage ? `<p>Mensagem: ${safeMessage}</p>` : ''),
    );

    return lead;
  }
}

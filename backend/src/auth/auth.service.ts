import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import { PasswordService } from './password.service';
import { TokenPair, TokenService } from './token.service';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  locale: string;
}

const toPublic = (u: PublicUser): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  locale: u.locale,
});

@Injectable()
export class AuthService {
  // Compared against when the e-mail is unknown, so timing does not reveal which e-mails exist.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, name: dto.name, passwordHash },
      });
      await this.audit.record({
        actorUserId: user.id,
        action: 'user.registered',
        entityType: 'User',
        entityId: user.id,
      });
      return toPublic(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('E-mail already registered');
      }
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair & { user: PublicUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    this.dummyHash ??= this.passwords.hash('dummy-password-for-timing');
    const ok = await this.passwords.verify(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    const pair = await this.tokens.issue(user.id);
    await this.audit.record({
      actorUserId: user.id,
      action: 'user.logged_in',
      entityType: 'User',
      entityId: user.id,
    });
    return { ...pair, user: toPublic(user) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return (await this.tokens.rotate(refreshToken)).pair;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  async me(userId: string): Promise<{
    user: PublicUser;
    memberships: { companyId: string; companyName: string; role: string }[];
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { where: { active: true }, include: { company: true } } },
    });
    return {
      user: toPublic(user),
      memberships: user.memberships.map((m) => ({
        companyId: m.companyId,
        companyName: m.company.name,
        role: m.role,
      })),
    };
  }
}
